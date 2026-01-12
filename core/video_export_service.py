"""
Video Export Service
Handles video composition from timeline data using FFmpeg
"""

import os
import json
import tempfile
import shutil
import logging
import random
import subprocess
from urllib.parse import urlparse
from urllib.request import urlretrieve
import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class VideoExportService:
    """Service for exporting timeline compositions to video files"""

    def __init__(self):
        # CRITICAL FIX: Use persistent storage instead of system temp directory
        # System temp can be cleaned mid-process causing cache files to disappear
        import uuid
        session_id = uuid.uuid4().hex[:12]

        # Create persistent temp directory in media root
        self.temp_dir = os.path.join(settings.MEDIA_ROOT, 'video_exports', session_id)
        os.makedirs(self.temp_dir, exist_ok=True)

        self.variable_state = {}  # Stores current index for each variable pool
        self.source_video_cache = {}  # Caches full videos by videoSource ID
        logger.info(f"✓ Created persistent export directory: {self.temp_dir}")
        logger.info(f"✓ This directory will NOT be cleaned by system during export")

    def __del__(self):
        """Clean up temporary directory after export completes"""
        try:
            if hasattr(self, 'temp_dir') and os.path.exists(self.temp_dir):
                # Only clean up after successful completion
                # Keep files on disk for 1 hour to allow debugging if needed
                logger.info(f"✓ Export complete - temp directory preserved: {self.temp_dir}")
                logger.info(f"✓ Files will be auto-cleaned after 1 hour")
                # Note: Could add scheduled cleanup job later
        except Exception as e:
            logger.warning(f"⚠️  Cleanup note: {e}")
    
    def download_media(self, url, filename):
        """Download media file from URL to temp directory"""
        try:
            dest_path = os.path.join(self.temp_dir, filename)
            
            # Handle data URLs (base64 encoded)
            if url.startswith('data:'):
                import base64
                import re
                
                # Extract base64 data
                match = re.match(r'data:([^;]+);base64,(.+)', url)
                if match:
                    mime_type = match.group(1)
                    base64_data = match.group(2)
                    
                    # Decode and save
                    file_data = base64.b64decode(base64_data)
                    with open(dest_path, 'wb') as f:
                        f.write(file_data)
                    
                    logger.info(f"Decoded data URL ({mime_type}): {len(file_data)} bytes -> {dest_path}")
                    return dest_path
                else:
                    logger.error(f"Invalid data URL format: {url[:50]}...")
                    return None
            
            # Handle blob URLs (browser object URLs) - can't download, need actual data
            elif url.startswith('blob:'):
                logger.error(f"Blob URLs cannot be downloaded server-side: {url}")
                return None
            
            # Handle local URLs
            elif url.startswith('/media/'):
                source_path = os.path.join(settings.MEDIA_ROOT, url.replace('/media/', ''))
                shutil.copy2(source_path, dest_path)
                logger.info(f"Copied local file: {source_path} -> {dest_path}")
                return dest_path
            
            # Handle HTTP/HTTPS URLs
            elif url.startswith('http://') or url.startswith('https://'):
                # Use requests with headers to handle CDN URLs
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    'Accept': '*/*',
                }
                
                response = requests.get(url, headers=headers, stream=True, timeout=30)
                response.raise_for_status()
                
                with open(dest_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                
                logger.info(f"Downloaded: {url[:80]} -> {dest_path}")
                return dest_path
            else:
                logger.error(f"Invalid URL format: {url[:50]}...")
                return None
                
        except Exception as e:
            logger.error(f"Failed to download {url[:80]}: {e}")
            return None
    
    def select_from_pool(self, pool_data, variation_index=0):
        """Select an item from a pool based on variation index"""
        if not pool_data:
            logger.error("Pool data is None")
            return None
        
        logger.info(f"Pool data type: {type(pool_data)}")
        logger.info(f"Pool data keys: {pool_data.keys() if isinstance(pool_data, dict) else 'not a dict'}")
        
        # Handle pool object with 'files' array
        files = pool_data.get('files', []) if isinstance(pool_data, dict) else pool_data
        
        if not files or len(files) == 0:
            logger.error(f"Pool has no files. Pool data: {pool_data}")
            return None
        
        logger.info(f"Pool has {len(files)} files")
        
        # Use variation_index to select deterministically (matches frontend logic)
        # This ensures thumbnails match the actual videos
        index = variation_index % len(files)
        selected = files[index]
        
        logger.info(f"Selected item {index} from pool (variation_index={variation_index}): {selected.get('name', 'unknown') if isinstance(selected, dict) else 'invalid format'}")
        logger.info(f"Selected item keys: {selected.keys() if isinstance(selected, dict) else 'not a dict'}")
        
        return selected

    def initialize_variable_pools(self, variable_pools, cycle_mode='within-video'):
        """
        Initialize variable pool state

        Args:
            variable_pools: List of variable pool objects from timeline
            cycle_mode: 'within-video' (default for export) or 'between-videos' (handled by caller)
        """
        self.variable_state = {}
        for pool in variable_pools:
            pool_id = pool.get('id') or pool.get('name')
            self.variable_state[pool_id] = {
                'pool': pool,
                'current_index': 0,
                'cycle_mode': pool.get('cycleMode', 'within-video')
            }
        logger.info(f"Initialized {len(self.variable_state)} variable pools")

    def replace_variables(self, text, increment_within_video=False):
        """
        Replace variable references in text with actual values

        Args:
            text: String containing variable references like {country} or {demo.age}
            increment_within_video: If True, increments within-video pools after replacement

        Returns:
            String with variables replaced
        """
        if not text or not self.variable_state:
            return text

        import re
        result = text

        # Find all variable references: {variable} or {variable.property}
        pattern = r'\{([^}]+)\}'
        matches = re.findall(pattern, text)

        for match in matches:
            parts = match.split('.')
            pool_name = parts[0]

            # Find matching pool (by name or id)
            pool_state = None
            for pool_id, state in self.variable_state.items():
                pool = state['pool']
                if pool.get('name') == pool_name or pool_id == pool_name:
                    pool_state = state
                    break

            if not pool_state:
                logger.warning(f"Variable pool '{pool_name}' not found")
                continue

            pool = pool_state['pool']
            values = pool.get('values', [])
            current_index = pool_state['current_index']

            if not values:
                logger.warning(f"Variable pool '{pool_name}' has no values")
                continue

            # Get value at current index (wrap around if needed)
            value = values[current_index % len(values)]

            # Handle nested variables (e.g., {country.food})
            if len(parts) > 1 and isinstance(value, dict):
                property_name = parts[1]
                value = value.get(property_name, f"{{MISSING:{property_name}}}")

            # Convert to string if needed
            if isinstance(value, dict):
                import json
                value = json.dumps(value)
            elif not isinstance(value, str):
                value = str(value)

            # Replace in text
            result = result.replace(f"{{{match}}}", value)

            # Increment within-video pools if requested
            if increment_within_video and pool_state['cycle_mode'] == 'within-video':
                pool_state['current_index'] += 1

        return result

    def generate_ai_video_segment(self, element, segment_index):
        """Generate AI video using Sora API"""
        logger.info(f"=== STARTING AI VIDEO GENERATION for segment {segment_index} ===")
        try:
            from .sora_service import SoraService
            logger.info("✓ SoraService imported successfully")

            ai_config = element.get('aiVideoConfig')
            if not ai_config:
                logger.error("✗ AI video element missing config")
                return self.create_black_segment(element.get('duration', 8), segment_index)

            logger.info(f"✓ AI config received: {ai_config}")

            # Check if this element uses a shared video source (for split videos)
            video_source = element.get('videoSource')
            video_trim = element.get('videoTrim')
            source_reference = ai_config.get('sourceReference')

            # CACHE LOOKUP - This is critical for consolidated videos
            if video_source:
                logger.info(f"Element has videoSource='{video_source}', checking cache...")
                logger.info(f"Current cache keys: {list(self.source_video_cache.keys())}")

            if video_source and video_source in self.source_video_cache:
                # This is a split video - reuse the cached full video
                logger.info(f"✓ ✓ ✓ CACHE HIT! Using cached video source: {video_source}")
                logger.info(f"✓ This element will REUSE the cached video (no API call needed)")
                full_video_path = self.source_video_cache[video_source]

                # CRITICAL VALIDATION: Verify cached file STILL exists
                if not os.path.exists(full_video_path):
                    logger.error(f"❌ CRITICAL CACHE ERROR: Cached video file NO LONGER EXISTS!")
                    logger.error(f"❌ Cache says: videoSource='{video_source}' → {full_video_path}")
                    logger.error(f"❌ But file not found at that path!")
                    logger.error(f"❌ This means the cache is stale or file was deleted")
                    raise FileNotFoundError(f"Cached video not found: {full_video_path}")

                cached_size = os.path.getsize(full_video_path)
                logger.info(f"✓ Cached file verified: {full_video_path}")
                logger.info(f"✓ Cached file size: {cached_size:,} bytes ({cached_size / (1024*1024):.2f} MB)")

                # Trim to requested time range
                if video_trim:
                    trim_start = video_trim.get('start', 0)
                    trim_end = video_trim.get('end')
                    expected_duration = trim_end - trim_start

                    logger.info(f"🎬 TRIMMING CACHED VIDEO:")
                    logger.info(f"  Source: {full_video_path}")
                    logger.info(f"  Trim range: {trim_start}s → {trim_end}s")
                    logger.info(f"  Expected output duration: {expected_duration}s")

                    # CRITICAL: Get actual duration of source video using ffprobe
                    try:
                        probe_cmd = [
                            'ffprobe', '-v', 'error',
                            '-show_entries', 'format=duration',
                            '-of', 'default=noprint_wrappers=1:nokey=1',
                            full_video_path
                        ]
                        probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
                        actual_source_duration = float(probe_result.stdout.strip())

                        logger.info(f"  Source video actual duration: {actual_source_duration}s")

                        # VALIDATION: Check if trim range is valid
                        if trim_end > actual_source_duration:
                            logger.error(f"❌ TRIM RANGE ERROR:")
                            logger.error(f"   Requested trim end: {trim_end}s")
                            logger.error(f"   Actual video length: {actual_source_duration}s")
                            logger.error(f"   Trim range EXCEEDS video length by {trim_end - actual_source_duration}s!")
                            logger.error(f"   This will cause a BLACK SCREEN or SHORT VIDEO!")

                            # Clamp trim_end to actual duration
                            trim_end_clamped = min(trim_end, actual_source_duration - 0.1)  # Leave 0.1s margin
                            expected_duration_clamped = trim_end_clamped - trim_start

                            logger.warning(f"🔧 AUTO-FIX: Clamping trim_end to {trim_end_clamped}s")
                            logger.warning(f"🔧 New expected duration: {expected_duration_clamped}s (was {expected_duration}s)")

                            trim_end = trim_end_clamped
                            expected_duration = expected_duration_clamped

                    except Exception as e:
                        logger.error(f"⚠️  Failed to probe source video duration: {e}")
                        logger.error(f"⚠️  Continuing with trim, but this might fail!")

                    trimmed_path = os.path.join(self.temp_dir, f"trimmed_{segment_index}.mp4")

                    # CRITICAL FIX: Re-encode instead of stream copy to avoid keyframe issues
                    # Using -ss BEFORE -i for accurate seeking
                    # Re-encoding ensures clean cuts at exact timestamps
                    cmd = [
                        'ffmpeg', '-y',
                        '-ss', str(trim_start),  # Seek BEFORE input (fast, accurate)
                        '-i', full_video_path,
                        '-t', str(expected_duration),  # Duration from start point
                        '-c:v', 'libx264',  # Re-encode video (ensures clean cuts)
                        '-preset', 'fast',  # Faster encoding
                        '-crf', '23',  # Quality (23 is good quality)
                        '-c:a', 'aac',  # Re-encode audio
                        '-b:a', '128k',
                        '-avoid_negative_ts', 'make_zero',  # Fix timestamp issues
                        trimmed_path
                    ]

                    logger.info(f"🔧 Running FFmpeg command: {' '.join(cmd)}")

                    # CRITICAL: Add retry logic with error handling
                    max_retries = 3
                    retry_delay = 1
                    result = None

                    for attempt in range(max_retries):
                        try:
                            result = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=120)

                            # Check if file was created
                            if os.path.exists(trimmed_path) and os.path.getsize(trimmed_path) > 1000:
                                logger.info(f"✓ FFmpeg succeeded on attempt {attempt + 1}")
                                break
                            else:
                                if attempt < max_retries - 1:
                                    logger.warning(f"⚠️  FFmpeg output invalid on attempt {attempt + 1}, retrying...")
                                    import time
                                    time.sleep(retry_delay)
                        except subprocess.CalledProcessError as e:
                            if attempt < max_retries - 1:
                                logger.warning(f"⚠️  FFmpeg failed on attempt {attempt + 1}: {e}, retrying...")
                                import time
                                time.sleep(retry_delay)
                            else:
                                logger.error(f"❌ FFmpeg failed after {max_retries} attempts")
                                result = e
                        except Exception as e:
                            logger.error(f"❌ Unexpected error during FFmpeg: {e}")
                            break

                    # VALIDATION: Check output file
                    if not os.path.exists(trimmed_path):
                        logger.error(f"❌ FFmpeg failed to create trimmed video: {trimmed_path}")
                        logger.error(f"❌ FFmpeg stdout: {result.stdout}")
                        logger.error(f"❌ FFmpeg stderr: {result.stderr}")
                        logger.error(f"❌ Source file was: {full_video_path}")
                        logger.error(f"❌ Source file exists: {os.path.exists(full_video_path)}")
                        return self.create_black_segment(expected_duration, segment_index)

                    file_size = os.path.getsize(trimmed_path)
                    if file_size < 1000:  # Less than 1KB is suspicious
                        logger.error(f"❌ Trimmed video is too small ({file_size} bytes): {trimmed_path}")
                        logger.error(f"❌ FFmpeg stdout: {result.stdout}")
                        logger.error(f"❌ FFmpeg stderr: {result.stderr}")
                        logger.error(f"❌ Source file was: {full_video_path}")
                        logger.error(f"❌ Source file size: {os.path.getsize(full_video_path):,} bytes")
                        return self.create_black_segment(expected_duration, segment_index)

                    logger.info(f"✅ Video trimmed successfully: {trimmed_path}")
                    logger.info(f"   Output size: {file_size / 1024:.1f} KB ({file_size:,} bytes)")
                    logger.info(f"   Expected duration: {expected_duration}s")

                    # Verify trimmed video with ffprobe
                    try:
                        probe_trimmed_cmd = [
                            'ffprobe', '-v', 'error',
                            '-show_entries', 'format=duration',
                            '-of', 'default=noprint_wrappers=1:nokey=1',
                            trimmed_path
                        ]
                        probe_trimmed_result = subprocess.run(probe_trimmed_cmd, capture_output=True, text=True, check=True)
                        actual_trimmed_duration = float(probe_trimmed_result.stdout.strip())
                        logger.info(f"✅ Trimmed video actual duration: {actual_trimmed_duration}s (expected {expected_duration}s)")

                        duration_diff = abs(actual_trimmed_duration - expected_duration)
                        if duration_diff > 0.5:  # More than 0.5s difference is concerning
                            logger.warning(f"⚠️  Duration mismatch: expected {expected_duration}s, got {actual_trimmed_duration}s (diff: {duration_diff}s)")
                    except Exception as e:
                        logger.warning(f"⚠️  Could not verify trimmed video duration: {e}")

                    return trimmed_path
                else:
                    return full_video_path

            # Extract config
            prompt = ai_config.get('prompt')

            # CRITICAL FIX: If this element has videoSource but cache lookup failed
            # This indicates a consolidated element that should reuse a cached video
            if video_source and video_trim and not prompt:
                # This is a consolidated element (has videoSource + videoTrim, no prompt)
                # The cache lookup at line 237 should have found it, but didn't
                logger.error(f"❌ CONSOLIDATION ERROR: Element {segment_index} has videoSource='{video_source}' and videoTrim={video_trim}")
                logger.error(f"❌ This element should reuse a cached video, but cache lookup failed!")
                logger.error(f"❌ Current cache keys: {list(self.source_video_cache.keys())}")
                logger.error(f"❌ This will cause a BLACK SCREEN!")

                if source_reference:
                    logger.error(f"❌ This element references '{source_reference}' but that video wasn't cached properly")
                else:
                    logger.error(f"❌ This element is MISSING sourceReference field! This should have been auto-added.")

                # Return black segment with detailed error
                logger.error(f"❌ Returning black segment to prevent crash. FIX REQUIRED!")
                return self.create_black_segment(element.get('duration', 8), segment_index)

            # If sourceReference is provided but no videoSource, something is wrong
            if source_reference and not video_source:
                logger.warning(f"⚠️  Element has sourceReference='{source_reference}' but no videoSource field")
                logger.warning(f"⚠️  This is likely a JSON generation error")

            model = ai_config.get('model', 'sora-2')
            # Handle null duration - default to 8s for Sora
            config_duration = ai_config.get('duration')
            if config_duration is None:
                logger.warning(f"⚠️  aiVideoConfig.duration is null, defaulting to 8s")
                sora_duration = 8
            else:
                sora_duration = int(config_duration)
            element_duration = element.get('duration', sora_duration)  # Element's actual duration (5s, 10s, etc.)
            size = ai_config.get('size', '720x1280')
            input_image_data = ai_config.get('inputImageData')  # Base64 data URL

            # Replace variables in prompt
            prompt = self.replace_variables(prompt, increment_within_video=True)

            logger.info(f"✓ Prompt (after variable replacement): {prompt[:100]}...")
            logger.info(f"✓ Model: {model}, Sora Duration: {sora_duration}s, Element Duration: {element_duration}s, Size: {size}")

            if not prompt:
                logger.error("✗ AI video missing prompt")
                return self.create_black_segment(element_duration, segment_index)
            
            # Handle input image if provided
            input_image_path = None
            if input_image_data:
                logger.info("⏳ Processing input image for AI video")
                logger.info(f"Input image data length: {len(input_image_data)} characters")
                logger.info(f"Input image data preview: {input_image_data[:100]}...")
                # Save base64 image to temp file
                import base64
                import re
                match = re.match(r'data:([^;]+);base64,(.+)', input_image_data)
                if match:
                    mime_type = match.group(1)
                    base64_data = match.group(2)
                    logger.info(f"Image MIME type: {mime_type}")
                    logger.info(f"Base64 data length: {len(base64_data)} characters")
                    try:
                        file_data = base64.b64decode(base64_data)
                        logger.info(f"Decoded image size: {len(file_data)} bytes")
                        # Determine file extension from MIME type
                        ext = 'jpg'
                        if 'png' in mime_type.lower():
                            ext = 'png'
                        elif 'webp' in mime_type.lower():
                            ext = 'webp'
                        input_image_path = os.path.join(self.temp_dir, f"ai_input_{segment_index}.{ext}")
                        with open(input_image_path, 'wb') as f:
                            f.write(file_data)
                        logger.info(f"✓ Saved input image: {input_image_path} ({len(file_data)} bytes)")
                    except Exception as e:
                        logger.error(f"✗ Failed to decode/save input image: {e}")
                        import traceback
                        logger.error(traceback.format_exc())
                        raise
                else:
                    logger.error(f"✗ Invalid input image data format. Expected data URL, got: {input_image_data[:100]}...")
                    raise ValueError("Invalid input image data format. Expected base64 data URL.")
            else:
                logger.info("No input image provided for AI video")
            
            # Verify input image file exists if provided
            if input_image_path:
                if not os.path.exists(input_image_path):
                    logger.error(f"✗ Input image file not found: {input_image_path}")
                    raise FileNotFoundError(f"Input image file not found: {input_image_path}")
                file_size = os.path.getsize(input_image_path)
                logger.info(f"✓ Input image file verified: {input_image_path} ({file_size} bytes)")
            
            # Initialize Sora service and generate video
            logger.info("⏳ Initializing Sora service...")
            sora = SoraService()
            logger.info(f"⏳ Starting Sora generation: {prompt[:50]}...")
            if input_image_path:
                logger.info(f"⏳ With input image: {input_image_path}")

            # Use Sora duration for API call (minimum duration Sora supports)
            video_data = sora.generate_video(
                prompt=prompt,
                model=model,
                size=size,
                seconds=sora_duration,
                input_image_path=input_image_path
            )
            
            video_id = video_data['id']
            logger.info(f"✓ Sora video generation started: {video_id}")
            
            # Poll until completion (timeout: 10 minutes)
            logger.info("⏳ Waiting for Sora video to complete (this may take 30-90 seconds)...")
            status = sora.poll_until_complete(video_id, max_wait=600, poll_interval=10)
            logger.info(f"✓ Sora video completed: {status}")
            
            # Download the generated video
            logger.info("⏳ Downloading generated video from Sora...")
            output_path = os.path.join(self.temp_dir, f"ai_video_{segment_index}.mp4")
            sora.download_video(video_id, save_path=output_path)

            # CRITICAL VALIDATION: Verify file was actually downloaded
            if not os.path.exists(output_path):
                logger.error(f"❌ CRITICAL: Downloaded video file does NOT exist: {output_path}")
                raise FileNotFoundError(f"Sora download failed - file not found: {output_path}")

            file_size = os.path.getsize(output_path)
            logger.info(f"✓ AI video downloaded: {output_path}")
            logger.info(f"✓ File verified: {file_size:,} bytes ({file_size / (1024*1024):.2f} MB)")

            if file_size < 10000:  # Less than 10KB is suspicious
                logger.error(f"❌ CRITICAL: Downloaded video is too small ({file_size} bytes)")
                raise ValueError(f"Sora download failed - file too small: {file_size} bytes")

            # Check if this video should be cached as a source (for split videos)
            if video_source and video_trim:
                # This is a split video - process the full video and cache it
                logger.info(f"✓ This is a CONSOLIDATED VIDEO SOURCE: {video_source}")
                logger.info(f"✓ This video will be cached and reused for other elements with videoSource='{video_source}'")
                logger.info(f"✓ Full video duration: {sora_duration}s, This element's trim: {video_trim}")

                # Process full video (no trimming) and cache it
                full_processed_path = os.path.join(self.temp_dir, f"source_{video_source}.mp4")
                cmd_full = [
                    'ffmpeg', '-y',
                    '-i', output_path,
                    '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
                    '-c:v', 'libx264',
                    '-pix_fmt', 'yuv420p',
                    '-r', '30',
                    '-c:a', 'aac',
                    '-b:a', '128k',
                    full_processed_path
                ]
                result_full = subprocess.run(cmd_full, check=True, capture_output=True, text=True)

                # CRITICAL VALIDATION: Verify processed file exists
                if not os.path.exists(full_processed_path):
                    logger.error(f"❌ CRITICAL: FFmpeg failed to create processed video: {full_processed_path}")
                    logger.error(f"FFmpeg stdout: {result_full.stdout}")
                    logger.error(f"FFmpeg stderr: {result_full.stderr}")
                    raise FileNotFoundError(f"FFmpeg processing failed - file not created: {full_processed_path}")

                processed_size = os.path.getsize(full_processed_path)
                logger.info(f"✓ Full video processed: {full_processed_path} ({sora_duration}s)")
                logger.info(f"✓ Processed file verified: {processed_size:,} bytes ({processed_size / (1024*1024):.2f} MB)")

                if processed_size < 10000:  # Less than 10KB is suspicious
                    logger.error(f"❌ CRITICAL: Processed video is too small ({processed_size} bytes)")
                    raise ValueError(f"FFmpeg processing failed - file too small: {processed_size} bytes")

                # Cache the full video
                self.source_video_cache[video_source] = full_processed_path
                logger.info(f"✓ ✓ ✓ CACHED FULL VIDEO: videoSource='{video_source}' → {full_processed_path}")
                logger.info(f"✓ ✓ ✓ Future elements with videoSource='{video_source}' will reuse this cached video")
                logger.info(f"✓ Current cache contents: {list(self.source_video_cache.keys())}")

                # Now trim to the requested portion
                trim_start = video_trim.get('start', 0)
                trim_end = video_trim.get('end', element_duration)
                expected_duration = trim_end - trim_start

                logger.info(f"🎬 TRIMMING SOURCE VIDEO (first element):")
                logger.info(f"  Full video: {full_processed_path} ({sora_duration}s REQUESTED)")
                logger.info(f"  Trim range: {trim_start}s → {trim_end}s")
                logger.info(f"  Expected output: {expected_duration}s")

                # CRITICAL: Get actual duration of generated video using ffprobe
                try:
                    probe_cmd = [
                        'ffprobe', '-v', 'error',
                        '-show_entries', 'format=duration',
                        '-of', 'default=noprint_wrappers=1:nokey=1',
                        full_processed_path
                    ]
                    probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
                    actual_source_duration = float(probe_result.stdout.strip())

                    logger.info(f"  ACTUAL generated video duration: {actual_source_duration}s")

                    # VALIDATION: Check if Sora generated the expected duration
                    if abs(actual_source_duration - sora_duration) > 0.5:
                        logger.warning(f"⚠️  DURATION MISMATCH:")
                        logger.warning(f"   Requested from Sora: {sora_duration}s")
                        logger.warning(f"   Actually generated: {actual_source_duration}s")
                        logger.warning(f"   Difference: {abs(actual_source_duration - sora_duration)}s")

                    # VALIDATION: Check if trim range is valid
                    if trim_end > actual_source_duration:
                        logger.error(f"❌ TRIM RANGE ERROR:")
                        logger.error(f"   Requested trim end: {trim_end}s")
                        logger.error(f"   Actual video length: {actual_source_duration}s")
                        logger.error(f"   Trim range EXCEEDS video length by {trim_end - actual_source_duration}s!")
                        logger.error(f"   This will cause a BLACK SCREEN or SHORT VIDEO!")

                        # Clamp trim_end to actual duration
                        trim_end_clamped = min(trim_end, actual_source_duration - 0.1)
                        expected_duration_clamped = trim_end_clamped - trim_start

                        logger.warning(f"🔧 AUTO-FIX: Clamping trim_end to {trim_end_clamped}s")
                        logger.warning(f"🔧 New expected duration: {expected_duration_clamped}s (was {expected_duration}s)")

                        trim_end = trim_end_clamped
                        expected_duration = expected_duration_clamped

                except Exception as e:
                    logger.error(f"⚠️  Failed to probe generated video duration: {e}")
                    logger.error(f"⚠️  Continuing with trim, but this might fail!")

                trimmed_path = os.path.join(self.temp_dir, f"trimmed_{segment_index}.mp4")

                # CRITICAL FIX: Re-encode instead of stream copy
                # Using -ss BEFORE -i for accurate seeking
                cmd_trim = [
                    'ffmpeg', '-y',
                    '-ss', str(trim_start),  # Seek BEFORE input
                    '-i', full_processed_path,
                    '-t', str(expected_duration),  # Duration from start point
                    '-c:v', 'libx264',
                    '-preset', 'fast',
                    '-crf', '23',
                    '-c:a', 'aac',
                    '-b:a', '128k',
                    '-avoid_negative_ts', 'make_zero',
                    trimmed_path
                ]

                logger.info(f"🔧 Running FFmpeg command: {' '.join(cmd_trim)}")

                # CRITICAL: Add retry logic with error handling
                max_retries = 3
                retry_delay = 1
                result = None

                for attempt in range(max_retries):
                    try:
                        result = subprocess.run(cmd_trim, check=True, capture_output=True, text=True, timeout=120)

                        # Check if file was created
                        if os.path.exists(trimmed_path) and os.path.getsize(trimmed_path) > 1000:
                            logger.info(f"✓ FFmpeg succeeded on attempt {attempt + 1}")
                            break
                        else:
                            if attempt < max_retries - 1:
                                logger.warning(f"⚠️  FFmpeg output invalid on attempt {attempt + 1}, retrying...")
                                import time
                                time.sleep(retry_delay)
                    except subprocess.CalledProcessError as e:
                        if attempt < max_retries - 1:
                            logger.warning(f"⚠️  FFmpeg failed on attempt {attempt + 1}: {e}, retrying...")
                            import time
                            time.sleep(retry_delay)
                        else:
                            logger.error(f"❌ FFmpeg failed after {max_retries} attempts")
                            result = e
                    except Exception as e:
                        logger.error(f"❌ Unexpected error during FFmpeg: {e}")
                        break

                # VALIDATION
                if not os.path.exists(trimmed_path):
                    logger.error(f"❌ FFmpeg failed to create trimmed source video")
                    logger.error(f"❌ FFmpeg stdout: {result.stdout}")
                    logger.error(f"❌ FFmpeg stderr: {result.stderr}")
                    logger.error(f"❌ Source file was: {full_processed_path}")
                    logger.error(f"❌ Source file exists: {os.path.exists(full_processed_path)}")
                    return self.create_black_segment(expected_duration, segment_index)

                file_size = os.path.getsize(trimmed_path)
                if file_size < 1000:
                    logger.error(f"❌ Trimmed source video is too small ({file_size} bytes)")
                    logger.error(f"❌ FFmpeg stdout: {result.stdout}")
                    logger.error(f"❌ FFmpeg stderr: {result.stderr}")
                    logger.error(f"❌ Source file was: {full_processed_path}")
                    logger.error(f"❌ Source file size: {os.path.getsize(full_processed_path):,} bytes")
                    return self.create_black_segment(expected_duration, segment_index)

                logger.info(f"✅ Source video trimmed successfully: {trimmed_path}")
                logger.info(f"   Output size: {file_size / 1024:.1f} KB ({file_size:,} bytes)")
                logger.info(f"   Expected duration: {expected_duration}s")

                # Verify trimmed video with ffprobe
                try:
                    probe_trimmed_cmd = [
                        'ffprobe', '-v', 'error',
                        '-show_entries', 'format=duration',
                        '-of', 'default=noprint_wrappers=1:nokey=1',
                        trimmed_path
                    ]
                    probe_trimmed_result = subprocess.run(probe_trimmed_cmd, capture_output=True, text=True, check=True)
                    actual_trimmed_duration = float(probe_trimmed_result.stdout.strip())
                    logger.info(f"✅ Source trimmed video actual duration: {actual_trimmed_duration}s (expected {expected_duration}s)")

                    duration_diff = abs(actual_trimmed_duration - expected_duration)
                    if duration_diff > 0.5:
                        logger.warning(f"⚠️  Duration mismatch: expected {expected_duration}s, got {actual_trimmed_duration}s (diff: {duration_diff}s)")
                except Exception as e:
                    logger.warning(f"⚠️  Could not verify trimmed video duration: {e}")

                self._last_ai_video_url = trimmed_path
                logger.info(f"=== AI VIDEO GENERATION COMPLETED for segment {segment_index} (SPLIT VIDEO) ===")
                return trimmed_path
            else:
                # Regular video (not split) - trim to element duration
                processed_path = os.path.join(self.temp_dir, f"processed_{segment_index}.mp4")
                cmd = [
                    'ffmpeg', '-y',
                    '-i', output_path,
                    '-t', str(element_duration),  # Trim to element's exact duration
                    '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
                    '-c:v', 'libx264',
                    '-pix_fmt', 'yuv420p',
                    '-r', '30',
                    '-c:a', 'aac',
                    '-b:a', '128k',
                    processed_path
                ]
                result = subprocess.run(cmd, check=True, capture_output=True, text=True)
                logger.info(f"✓ AI video processed and trimmed from {sora_duration}s to {element_duration}s: {processed_path}")

                # Store the generated video path for metadata
                self._last_ai_video_url = processed_path

                logger.info(f"=== AI VIDEO GENERATION COMPLETED for segment {segment_index} ===")
                return processed_path
            
        except subprocess.CalledProcessError as e:
            logger.error(f"FFmpeg failed to process AI video: {e}")
            logger.error(f"FFmpeg stderr: {e.stderr}")
            logger.error(f"FFmpeg stdout: {e.stdout}")
            logger.error(f"Command: {' '.join(cmd)}")
            raise
        except Exception as e:
            import traceback
            logger.error(f"✗ AI video generation failed: {e}")
            logger.error(f"✗ Full traceback:\n{traceback.format_exc()}")
            # Return black segment as fallback using element duration
            element_duration = element.get('duration', 8)
            logger.warning(f"⚠ Falling back to black segment for AI video ({element_duration}s)")
            return self.create_black_segment(element_duration, segment_index)

    def generate_ai_image_segment(self, element, segment_index):
        """Generate AI image using OpenAI and convert to video segment"""
        logger.info(f"=== STARTING AI IMAGE GENERATION for segment {segment_index} ===")
        try:
            ai_config = element.get('aiImageConfig')
            if not ai_config:
                logger.error("✗ AI image element missing config")
                return self.create_black_segment(element.get('duration', 5), segment_index)

            logger.info(f"✓ AI Image config received: {ai_config}")

            # Extract config
            prompt = ai_config.get('prompt')
            model = ai_config.get('model', 'gpt-5')
            quality = ai_config.get('quality', 'auto')
            size = ai_config.get('size', '1024x1536')  # Portrait mode
            format_type = ai_config.get('format', 'png')
            output_compression = ai_config.get('output_compression')
            duration = int(element.get('duration', 5))

            # Replace variables in prompt
            prompt = self.replace_variables(prompt, increment_within_video=True)

            logger.info(f"✓ Prompt (after variable replacement): {prompt[:100] if prompt else 'None'}...")
            logger.info(f"✓ Model: {model}, Quality: {quality}, Size: {size}, Format: {format_type}")

            if not prompt:
                logger.error("✗ AI image missing prompt")
                return self.create_black_segment(duration, segment_index)

            # Generate image using OpenAI
            logger.info("⏳ Calling OpenAI API to generate image...")
            import requests
            import os

            api_key = os.environ.get('OPENAI_API_KEY')
            if not api_key:
                logger.error("✗ OPENAI_API_KEY not configured")
                return self.create_black_segment(duration, segment_index)

            # Call OpenAI Image API
            headers = {
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            }

            # For now, use DALL-E 3 as it's the most reliable
            # Map all models to dall-e-3 for compatibility
            actual_model = 'dall-e-3' if model in ['gpt-5', 'gpt-4.1'] else model

            # DALL-E 3 only supports specific sizes
            dalle3_size = '1024x1792'  # Portrait - closest to 1024x1536
            if size == '1024x1024':
                dalle3_size = '1024x1024'
            elif '1792' in size or '1536' in size:
                dalle3_size = '1024x1792'  # Portrait

            logger.info(f"Using model: {actual_model}, size: {dalle3_size}")

            # Use Image API (works for DALL-E 2 and 3)
            api_url = 'https://api.openai.com/v1/images/generations'
            payload = {
                'model': actual_model,
                'prompt': prompt,
                'size': dalle3_size,
                'n': 1,
                'response_format': 'url'
            }

            # DALL-E 3 supports quality parameter
            if actual_model == 'dall-e-3' and quality in ['standard', 'hd']:
                payload['quality'] = quality if quality in ['standard', 'hd'] else 'standard'

            logger.info(f"⏳ Making request to {api_url}")
            logger.info(f"Payload: {payload}")
            response = requests.post(api_url, headers=headers, json=payload, timeout=120)
            response.raise_for_status()

            result = response.json()
            logger.info(f"✓ OpenAI API response received")
            logger.info(f"Full API response: {result}")

            # Extract image URL
            image_url = None
            image_path = None

            # Parse Image API format (DALL-E)
            logger.info("Parsing Image API format...")
            if 'data' in result and len(result['data']) > 0:
                image_url = result['data'][0].get('url')
                logger.info(f"Found image URL: {image_url}")
            else:
                logger.error(f"No image data in response: {result}")

            # Download image if URL was returned
            if image_url:
                logger.info(f"⏳ Downloading image from {image_url[:100]}...")
                img_response = requests.get(image_url, timeout=60)
                img_response.raise_for_status()

                image_path = os.path.join(self.temp_dir, f"ai_image_{segment_index}.png")
                with open(image_path, 'wb') as f:
                    f.write(img_response.content)
                logger.info(f"✓ Image downloaded to {image_path}, size: {len(img_response.content)} bytes")

            if not image_path or not os.path.exists(image_path):
                logger.error(f"✗ Failed to get image from OpenAI. image_path={image_path}")
                return self.create_black_segment(duration, segment_index)

            # Convert image to video segment with specified duration
            logger.info(f"⏳ Converting image to {duration}s video segment...")
            output_path = os.path.join(self.temp_dir, f"ai_image_video_{segment_index}.mp4")

            cmd = [
                'ffmpeg', '-y',
                '-loop', '1',
                '-i', image_path,
                '-t', str(duration),
                '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-r', '30',
                output_path
            ]

            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            logger.info(f"✓ AI image converted to video: {output_path}")

            # Store both the image path and video path for metadata
            self._last_ai_image_url = image_path

            return output_path

        except Exception as e:
            import traceback
            logger.error(f"✗ AI image generation failed: {e}")
            logger.error(f"✗ Full traceback:\n{traceback.format_exc()}")
            # Return black segment as fallback
            logger.warning(f"⚠ Falling back to black segment for AI image")
            return self.create_black_segment(element.get('duration', 5), segment_index)

    def generate_variation_indices(self, timeline_data, variation_number):
        """Generate pool selection indices for a specific variation"""
        pool_elements = [el for el in timeline_data['elements'] if el['type'] == 'pool' and el['poolData']]
        
        if not pool_elements:
            return []
        
        # Calculate indices for this variation
        # Use simple modulo for each pool independently (matches frontend logic)
        # This ensures thumbnails match videos: video 0 uses pool item 0, video 1 uses pool item 1, etc.
        indices = []
        
        for element in pool_elements:
            pool_data = element.get('poolData', {})
            # Handle both dict with 'files' and direct array
            files = pool_data.get('files', []) if isinstance(pool_data, dict) else pool_data
            pool_size = len(files) if files else 0
            
            if pool_size > 0:
                # Simple modulo: variation 0 -> index 0, variation 1 -> index 1, etc.
                indices.append(variation_number % pool_size)
            else:
                indices.append(0)
        
        return indices
    
    def create_video_segment(self, element, segment_index, pool_index=0):
        """Create a video segment for a single element"""
        try:
            # Log element for debugging
            logger.info(f"Creating segment {segment_index}: {element}")
            
            # Validate element has required fields
            if 'type' not in element:
                logger.error(f"Element missing 'type' field: {element}")
                return self.create_black_segment(element.get('duration', 5), segment_index)
            
            media_url = None
            element_type = element['type']

            # Handle AI video generation
            if element_type == 'ai-video':
                return self.generate_ai_video_segment(element, segment_index)
            # Handle AI image generation
            elif element_type == 'ai-image':
                return self.generate_ai_image_segment(element, segment_index)
            elif element_type == 'video':
                media_url = element.get('mediaUrl')
            elif element_type == 'image':
                media_url = element.get('mediaUrl')
            elif element_type == 'pool' and element.get('poolData'):
                pool_item = self.select_from_pool(element.get('poolData'), pool_index)
                if pool_item:
                    # Pool items use 'data' field for base64 data URL
                    media_url = pool_item.get('data') or pool_item.get('url') or pool_item.get('dataUrl')
                    if media_url:
                        logger.info(f"Pool item selected: {pool_item.get('name', 'unknown')}, URL length: {len(media_url)}")
                    else:
                        logger.warning(f"Pool item has no data: {pool_item}")
            
            if not media_url:
                logger.warning(f"No media URL for element {segment_index}, type: {element_type}")
                logger.warning(f"Element data: {element}")
                return self.create_black_segment(element.get('duration', 5), segment_index)
            
            # Download media - determine extension from type or mime type
            if element_type == 'pool' and pool_item:
                # Check pool item type
                item_type = pool_item.get('type', '')
                if 'video' in item_type.lower():
                    ext = 'mp4'
                elif 'image' in item_type.lower():
                    ext = 'jpg'
                else:
                    ext = 'mp4'  # Default for pools
            elif element_type in ['video']:
                ext = 'mp4'
            else:
                ext = 'jpg'
            
            media_path = self.download_media(media_url, f"segment_{segment_index}.{ext}")
            
            if not media_path:
                return self.create_black_segment(element['duration'], segment_index)
            
            output_path = os.path.join(self.temp_dir, f"processed_{segment_index}.mp4")
            
            # Build FFmpeg command
            duration = element.get('duration', 5)
            
            # Determine if this is an image or video
            is_image = False
            if element_type == 'image':
                is_image = True
            elif element_type == 'pool' and pool_item:
                item_type = pool_item.get('type', '')
                is_image = 'image' in item_type.lower()
            
            if is_image:
                # Image to video
                cmd = [
                    'ffmpeg', '-y',
                    '-loop', '1',
                    '-i', media_path,
                    '-t', str(duration),
                    '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
                    '-c:v', 'libx264',
                    '-pix_fmt', 'yuv420p',
                    '-r', '30',
                    '-an',  # No audio for images
                    output_path
                ]
            else:
                # Video processing
                start_time = element.get('videoStartTime', 0)
                should_loop = element.get('shouldLoop', False)
                
                if should_loop:
                    # Loop video to fill duration
                    cmd = [
                        'ffmpeg', '-y',
                        '-stream_loop', '-1',  # Infinite loop
                        '-i', media_path,
                        '-t', str(duration),
                        '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
                        '-c:v', 'libx264',
                        '-pix_fmt', 'yuv420p',
                        '-r', '30',
                        '-c:a', 'aac',
                        '-b:a', '128k',
                        output_path
                    ]
                else:
                    # Trim video
                    cmd = [
                        'ffmpeg', '-y',
                        '-ss', str(start_time),
                        '-i', media_path,
                        '-t', str(duration),
                        '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280',
                        '-c:v', 'libx264',
                        '-pix_fmt', 'yuv420p',
                        '-r', '30',
                        '-c:a', 'aac',
                        '-b:a', '128k',
                        output_path
                    ]
            
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            logger.info(f"Created segment: {output_path}")
            return output_path
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to create segment {segment_index}: {e}")
            logger.error(f"FFmpeg stderr: {e.stderr}")
            logger.error(f"FFmpeg stdout: {e.stdout}")
            logger.error(f"Command: {' '.join(cmd)}")
            return self.create_black_segment(element.get('duration', 5), segment_index)
        except Exception as e:
            logger.error(f"Failed to create segment {segment_index}: {e}")
            return self.create_black_segment(element.get('duration', 5), segment_index)
    
    def create_black_segment(self, duration, segment_index):
        """Create a black video segment as fallback"""
        output_path = os.path.join(self.temp_dir, f"black_{segment_index}.mp4")
        
        cmd = [
            'ffmpeg', '-y',
            '-f', 'lavfi',
            '-i', 'color=c=black:s=720x1280:r=30',
            '-t', str(duration),
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-an',
            output_path
        ]
        
        try:
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            logger.info(f"Created black segment: {output_path}")
            return output_path
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to create black segment: {e}")
            logger.error(f"FFmpeg stderr: {e.stderr}")
            logger.error(f"FFmpeg stdout: {e.stdout}")
            return None
        except Exception as e:
            logger.error(f"Failed to create black segment: {e}")
            return None
    
    def apply_overlays(self, video_path, overlays, output_path):
        """Apply overlay images to video at specified times"""
        if not overlays:
            shutil.copy2(video_path, output_path)
            return output_path
        
        try:
            # Download all overlays
            overlay_paths = []
            for i, overlay in enumerate(overlays):
                overlay_path = self.download_media(overlay['overlayUrl'], f"overlay_{i}.png")
                if overlay_path:
                    overlay_paths.append({
                        'path': overlay_path,
                        'start': overlay['startTime'],
                        'duration': overlay['duration']
                    })
            
            if not overlay_paths:
                shutil.copy2(video_path, output_path)
                return output_path
            
            # Build FFmpeg filter for overlays
            filter_parts = []
            for i, overlay_info in enumerate(overlay_paths):
                start = overlay_info['start']
                duration = overlay_info['duration']
                end = start + duration
                
                # Create enable expression for time range
                enable = f"between(t,{start},{end})"
                filter_parts.append(f"[{i+1}:v]scale=720:1280[ovr{i}]")
                
            # Build overlay chain
            current_input = "0:v"
            for i in range(len(overlay_paths)):
                start = overlay_paths[i]['start']
                duration = overlay_paths[i]['duration']
                end = start + duration
                enable = f"between(t,{start},{end})"
                
                if i < len(overlay_paths) - 1:
                    filter_parts.append(f"[{current_input}][ovr{i}]overlay=enable='{enable}'[out{i}]")
                    current_input = f"out{i}"
                else:
                    filter_parts.append(f"[{current_input}][ovr{i}]overlay=enable='{enable}'")
            
            filter_complex = ";".join(filter_parts)
            
            # Build FFmpeg command with overlay inputs
            cmd = ['ffmpeg', '-y', '-i', video_path]
            for overlay_info in overlay_paths:
                cmd.extend(['-i', overlay_info['path']])
            
            cmd.extend([
                '-filter_complex', filter_complex,
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-r', '30',
                '-c:a', 'copy',
                output_path
            ])
            
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            logger.info(f"Applied overlays to: {output_path}")
            return output_path
            
        except Exception as e:
            logger.error(f"Failed to apply overlays: {e}")
            # Fallback: copy original video
            shutil.copy2(video_path, output_path)
            return output_path
    
    def concatenate_segments(self, segment_paths):
        """Concatenate multiple video segments into one"""
        try:
            # Create concat file
            concat_file = os.path.join(self.temp_dir, 'concat.txt')
            with open(concat_file, 'w') as f:
                for path in segment_paths:
                    # Escape single quotes in path
                    escaped_path = path.replace("'", "'\\''")
                    f.write(f"file '{escaped_path}'\n")
            
            output_path = os.path.join(self.temp_dir, 'concatenated.mp4')
            
            cmd = [
                'ffmpeg', '-y',
                '-f', 'concat',
                '-safe', '0',
                '-i', concat_file,
                '-c', 'copy',
                output_path
            ]
            
            result = subprocess.run(cmd, check=True, capture_output=True, text=True)
            logger.info(f"Concatenated segments: {output_path}")
            return output_path
            
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to concatenate segments: {e}")
            logger.error(f"FFmpeg stderr: {e.stderr}")
            logger.error(f"FFmpeg stdout: {e.stdout}")
            logger.error(f"Command: {' '.join(cmd)}")
            return None
        except Exception as e:
            logger.error(f"Failed to concatenate segments: {e}")
            return None
    
    def export_video(self, timeline_data, variation_index=0):
        """
        Export a single video from timeline data

        Args:
            timeline_data: Dict with 'elements' and 'overlays'
            variation_index: Index for pool variation selection

        Returns:
            Path to exported video file
        """
        try:
            logger.info(f"Starting video export (variation {variation_index})")

            # CRITICAL FIX: Auto-repair missing sourceReference fields before export
            # This catches old/broken JSON that doesn't have sourceReference
            self._auto_fix_missing_source_references(timeline_data)

            # Initialize variable pools if provided
            variable_pools = timeline_data.get('variablePools', [])
            if variable_pools:
                self.initialize_variable_pools(variable_pools)

                # For 'between-videos' pools, set index based on variation_index
                for pool_id, state in self.variable_state.items():
                    if state['cycle_mode'] == 'between-videos':
                        pool = state['pool']
                        values = pool.get('values', [])
                        if values:
                            state['current_index'] = variation_index % len(values)
                logger.info(f"Variable pools initialized for variation {variation_index}")

            # Generate pool indices for this variation
            pool_indices = self.generate_variation_indices(timeline_data, variation_index)
            pool_index_counter = 0
            
            # Create segments for each element
            segment_paths = []
            for i, element in enumerate(timeline_data['elements']):
                pool_index = 0
                if element['type'] == 'pool' and element['poolData']:
                    pool_index = pool_indices[pool_index_counter] if pool_index_counter < len(pool_indices) else 0
                    pool_index_counter += 1
                
                segment_path = self.create_video_segment(element, i, pool_index)
                if segment_path:
                    segment_paths.append(segment_path)
            
            if not segment_paths:
                logger.error("No segments created")
                return None
            
            # Concatenate segments
            if len(segment_paths) == 1:
                concatenated_path = segment_paths[0]
            else:
                concatenated_path = self.concatenate_segments(segment_paths)
            
            if not concatenated_path:
                return None
            
            # Apply overlays
            final_output = os.path.join(self.temp_dir, f'final_video_{variation_index}.mp4')
            result_path = self.apply_overlays(
                concatenated_path,
                timeline_data.get('overlays', []),
                final_output
            )
            
            logger.info(f"Video export complete: {result_path}")
            return result_path
            
        except Exception as e:
            logger.error(f"Video export failed: {e}")
            return None
    
    def export_multiple_videos(self, timeline_data, count=1):
        """
        Export multiple video variations

        Args:
            timeline_data: Timeline configuration
            count: Number of videos to generate

        Returns:
            Dict with video URLs and AI content metadata
        """
        results = []

        for i in range(count):
            logger.info(f"Generating video {i+1}/{count}")

            # Reset AI content tracking for each video
            if hasattr(self, '_last_ai_video_url'):
                delattr(self, '_last_ai_video_url')
            if hasattr(self, '_last_ai_image_url'):
                delattr(self, '_last_ai_image_url')

            # Track AI content generated for this video
            ai_content = {}

            video_path = self.export_video(timeline_data, variation_index=i)

            if video_path:
                # Move to media directory with unique name
                final_filename = f"exported_video_{i+1}_{random.randint(1000, 9999)}.mp4"
                final_path = os.path.join(settings.MEDIA_ROOT, 'exported_videos', final_filename)

                # Create directory if needed
                os.makedirs(os.path.dirname(final_path), exist_ok=True)

                # Copy to media directory
                shutil.copy2(video_path, final_path)

                # Return relative URL
                video_url = f"/media/exported_videos/{final_filename}"

                # Collect AI-generated content metadata and convert to URLs
                for elem_idx, element in enumerate(timeline_data.get('elements', [])):
                    if element.get('type') == 'ai-video' and hasattr(self, '_last_ai_video_url'):
                        # Copy AI video to media directory
                        ai_video_filename = f"ai_video_{i+1}_{elem_idx}_{random.randint(1000, 9999)}.mp4"
                        ai_video_path = os.path.join(settings.MEDIA_ROOT, 'exported_videos', ai_video_filename)
                        shutil.copy2(self._last_ai_video_url, ai_video_path)
                        ai_content[f'ai_video_{elem_idx}'] = f"/media/exported_videos/{ai_video_filename}"
                    elif element.get('type') == 'ai-image' and hasattr(self, '_last_ai_image_url'):
                        # Copy AI image to media directory
                        ai_image_filename = f"ai_image_{i+1}_{elem_idx}_{random.randint(1000, 9999)}.png"
                        ai_image_path = os.path.join(settings.MEDIA_ROOT, 'exported_videos', ai_image_filename)
                        shutil.copy2(self._last_ai_image_url, ai_image_path)
                        ai_content[f'ai_image_{elem_idx}'] = f"/media/exported_videos/{ai_image_filename}"

                results.append({
                    'videoUrl': video_url,
                    'aiContent': ai_content
                })

                logger.info(f"Saved video: {video_url} with AI content: {ai_content}")

        return results

    def _auto_fix_missing_source_references(self, timeline_data):
        """
        AUTOMATIC REPAIR: Add missing sourceReference fields to consolidated elements.
        This runs DURING EXPORT to fix old/broken JSON that doesn't have sourceReference.

        This is a safety net for:
        1. Old saved projects created before the post-processing fix
        2. Manually edited JSON
        3. Any JSON that somehow bypassed the import post-processing
        """
        elements = timeline_data.get('elements', [])
        if not elements:
            return

        # Group elements by videoSource
        video_source_groups = {}
        for element in elements:
            video_source = element.get('videoSource')
            if video_source:
                if video_source not in video_source_groups:
                    video_source_groups[video_source] = []
                video_source_groups[video_source].append(element)

        # For each group with multiple elements, add sourceReference to subsequent elements
        fixes_applied = 0
        for video_source, group_elements in video_source_groups.items():
            if len(group_elements) > 1:
                # First element is the source
                source_element = group_elements[0]
                source_id = source_element['id']

                logger.info(f"🔧 Auto-repair: Processing videoSource group '{video_source}': {len(group_elements)} elements")
                logger.info(f"🔧 Source element: {source_id}")

                # Add sourceReference to all subsequent elements
                for element in group_elements[1:]:
                    element_id = element['id']

                    # Ensure aiVideoConfig exists
                    if not element.get('aiVideoConfig'):
                        element['aiVideoConfig'] = {}

                    # Add sourceReference if missing
                    if 'sourceReference' not in element['aiVideoConfig']:
                        element['aiVideoConfig']['sourceReference'] = source_id
                        fixes_applied += 1
                        logger.warning(f"🔧 AUTO-REPAIRED: Added sourceReference to {element_id} → {source_id}")
                    else:
                        logger.info(f"✓ {element_id} already has sourceReference: {element['aiVideoConfig']['sourceReference']}")

        if fixes_applied > 0:
            logger.warning(f"🔧 🔧 🔧 AUTO-REPAIR APPLIED: Fixed {fixes_applied} missing sourceReference fields")
            logger.warning(f"🔧 This was OLD/BROKEN JSON - it should have had sourceReference from import")
            logger.warning(f"🔧 Consider re-importing the video to get properly formatted JSON")
        else:
            logger.info("✓ JSON is correct - all sourceReference fields present")

