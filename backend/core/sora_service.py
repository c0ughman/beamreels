"""
Service for interacting with OpenAI's Sora video generation API
"""
from openai import OpenAI
from django.conf import settings
import logging
import time
import requests
import json
from django.core.files.base import ContentFile

logger = logging.getLogger(__name__)


class SoraService:
    """Service class for Sora video generation"""
    
    def __init__(self):
        """Initialize Sora service with OpenAI client"""
        self.client = OpenAI(api_key=settings.OPENAI_API_KEY)
    
    def generate_video(self, prompt, model="sora-2", size="1280x720", seconds=8, input_image_path=None):
        """
        Generate a video using Sora API
        
        Args:
            prompt (str): Text prompt for video generation
            model (str): Model to use (sora-2 or sora-2-pro)
            size (str): Video resolution (e.g., "1280x720", "1920x1080")
            seconds (int): Video duration in seconds - MUST be 4, 8, or 12 (default: 8)
            input_image_path (str, optional): Path to input image file to use as first frame
            
        Returns:
            dict: Response from OpenAI API with video information
            
        Raises:
            Exception: If video generation fails
        """
        try:
            # Validate seconds parameter
            valid_seconds = [4, 8, 12]
            if seconds not in valid_seconds:
                raise ValueError(f"Invalid duration: {seconds}. Must be one of {valid_seconds}")
            
            logger.info(f"Starting video generation with prompt: {prompt[:100]}...")
            logger.info(f"Model: {model}, Size: {size}, Duration: {seconds}s")
            if input_image_path:
                logger.info(f"Using input image: {input_image_path}")
            
            # Prepare API call parameters
            api_params = {
                'model': model,
                'prompt': prompt,
                'size': size,
                'seconds': str(seconds)
            }
            
            # Add input_reference if image provided
            # The OpenAI Python SDK may not support input_reference yet
            # So we'll use direct HTTP request with multipart/form-data for file uploads
            if input_image_path:
                import os
                # Verify file exists
                if not os.path.exists(input_image_path):
                    raise FileNotFoundError(f"Input image file not found: {input_image_path}")
                
                file_size = os.path.getsize(input_image_path)
                logger.info(f"Using direct HTTP request for file upload: {input_image_path} ({file_size} bytes)")
                
                # Use direct HTTP request with multipart/form-data
                # This is more reliable for file uploads than the SDK
                api_url = "https://api.openai.com/v1/videos"
                headers = {
                    "Authorization": f"Bearer {settings.OPENAI_API_KEY}"
                }
                
                # Determine MIME type from file extension
                file_ext = os.path.splitext(input_image_path)[1].lower()
                mime_type_map = {
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.png': 'image/png',
                    '.webp': 'image/webp'
                }
                mime_type = mime_type_map.get(file_ext, 'image/jpeg')
                
                # Prepare multipart form data
                with open(input_image_path, 'rb') as image_file:
                    files = {
                        'input_reference': (os.path.basename(input_image_path), image_file, mime_type)
                    }
                    data = {
                        'model': model,
                        'prompt': prompt,
                        'size': size,
                        'seconds': str(seconds)
                    }
                    
                    logger.info(f"Making HTTP POST request to {api_url} with file...")
                    response = requests.post(api_url, headers=headers, data=data, files=files, timeout=60)
                    
                    if response.status_code != 200:
                        error_msg = f"API request failed with status {response.status_code}: {response.text}"
                        logger.error(error_msg)
                        raise Exception(error_msg)
                    
                    video_response = response.json()
                    logger.info(f"API call successful with image: {video_response.get('id', 'unknown')}")
                    
                    # Convert response to match SDK format
                    video = type('Video', (), {
                        'id': video_response.get('id'),
                        'status': video_response.get('status', 'processing'),
                        'progress': video_response.get('progress', 0),
                        'created_at': video_response.get('created_at'),
                        'model': video_response.get('model'),
                    })()
            else:
                # Create video generation job without file (use SDK for this)
                video = self.client.videos.create(**api_params)
            
            logger.info(f"Video generation started: ID={video.id}, Status={video.status}")
            
            # Convert response to dict format
            video_data = {
                'id': video.id,
                'status': video.status,
                'model': model,
                'prompt': prompt,
                'size': size,
                'seconds': seconds,
                'progress': getattr(video, 'progress', 0),
                'created_at': getattr(video, 'created_at', None),
                'url': None,  # Will be set when completed
                'raw_response': str(video)
            }
            
            return video_data
            
        except Exception as e:
            logger.error(f"Error generating video: {str(e)}")
            raise Exception(f"Failed to generate video: {str(e)}")
    
    def get_video_status(self, video_id):
        """
        Check the status of a video generation
        
        Args:
            video_id (str): ID of the video to check
            
        Returns:
            dict: Video status information
        """
        try:
            logger.info(f"Checking status for video: {video_id}")
            video = self.client.videos.retrieve(video_id)
            
            status_data = {
                'id': video.id,
                'status': video.status,
                'progress': getattr(video, 'progress', 0),
                'model': getattr(video, 'model', None),
                'created_at': getattr(video, 'created_at', None),
            }
            
            # Add error information if failed
            if video.status == 'failed':
                error = getattr(video, 'error', None)
                if error:
                    status_data['error_message'] = getattr(error, 'message', 'Unknown error')
            
            logger.info(f"Video {video_id} status: {video.status}, progress: {status_data['progress']}%")
            return status_data
            
        except Exception as e:
            logger.error(f"Error checking video status: {str(e)}")
            raise Exception(f"Failed to check video status: {str(e)}")
    
    def download_video(self, video_id, save_path=None):
        """
        Download the completed video file
        
        Args:
            video_id (str): ID of the completed video
            save_path (str, optional): Path to save the video file
            
        Returns:
            bytes or ContentFile: Video content
        """
        try:
            logger.info(f"Downloading video: {video_id}")
            
            # Download video content
            content = self.client.videos.download_content(video_id, variant="video")
            
            if save_path:
                # Save to file
                content.write_to_file(save_path)
                logger.info(f"Video saved to: {save_path}")
                return save_path
            else:
                # Return as ContentFile for Django
                video_bytes = content.read()
                logger.info(f"Video downloaded: {len(video_bytes)} bytes")
                return ContentFile(video_bytes, name=f"{video_id}.mp4")
                
        except Exception as e:
            logger.error(f"Error downloading video: {str(e)}")
            raise Exception(f"Failed to download video: {str(e)}")
    
    def poll_until_complete(self, video_id, max_wait=600, poll_interval=10):
        """
        Poll video status until completion or timeout
        
        Args:
            video_id (str): ID of the video to monitor
            max_wait (int): Maximum seconds to wait (default: 600 = 10 minutes)
            poll_interval (int): Seconds between status checks (default: 10)
            
        Returns:
            dict: Final video status
            
        Raises:
            Exception: If generation fails or times out
        """
        start_time = time.time()
        
        while True:
            elapsed = time.time() - start_time
            if elapsed > max_wait:
                raise Exception(f"Video generation timed out after {max_wait} seconds")
            
            status = self.get_video_status(video_id)
            
            if status['status'] == 'completed':
                logger.info(f"Video {video_id} completed successfully")
                return status
            elif status['status'] == 'failed':
                error_msg = status.get('error_message', 'Unknown error')
                raise Exception(f"Video generation failed: {error_msg}")
            
            # Still in progress, wait and check again
            logger.info(f"Video {video_id} still processing (progress: {status.get('progress', 0)}%), waiting {poll_interval}s...")
            time.sleep(poll_interval)

