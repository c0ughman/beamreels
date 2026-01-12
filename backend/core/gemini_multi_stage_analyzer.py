"""
Multi-stage video analyzer using Gemini 2.0 Flash
5-stage sequential pipeline for maximum accuracy
"""
import os
import logging
import json
import time
import tempfile
from django.conf import settings
import google.generativeai as genai

logger = logging.getLogger(__name__)


class GeminiMultiStageAnalyzer:
    """5-stage sequential video analysis pipeline"""

    def __init__(self):
        """Initialize Gemini service"""
        api_key = getattr(settings, 'GEMINI_API_KEY', None)
        if not api_key:
            raise Exception("GEMINI_API_KEY not found in settings. Please add it to your .env file.")

        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-2.0-flash-exp')

    def analyze_video_and_generate_json(self, video_file):
        """
        Analyze video using 5-stage pipeline and generate timeline JSON

        Args:
            video_file: Django UploadedFile object

        Returns:
            dict: Timeline JSON in the project's format
        """
        temp_video_path = None

        try:
            # Save uploaded video to temporary file
            logger.info(f"Processing video file: {video_file.name}")
            temp_video_path = self._save_temp_video(video_file)

            # Upload video to Gemini
            logger.info("Uploading video to Gemini API...")
            video_file_obj = genai.upload_file(path=temp_video_path)

            # Wait for video processing
            logger.info("Waiting for Gemini to process video...")
            while video_file_obj.state.name == "PROCESSING":
                time.sleep(2)
                video_file_obj = genai.get_file(video_file_obj.name)

            if video_file_obj.state.name == "FAILED":
                raise Exception("Gemini failed to process the video")

            logger.info("Video processed successfully. Starting 5-stage analysis...")

            # STAGE 1: Foundation Analysis (Transcript + Context)
            logger.info("Stage 1/5: Foundation Analysis (Transcript + Context)...")
            foundation = self._stage1_foundation_analysis(video_file_obj)
            logger.info(f"Stage 1 complete: {foundation['videoType']}, {foundation['totalDuration']}s, {len(foundation['transcript'])} transcript segments")
            logger.info("=" * 80)
            logger.info("STAGE 1 OUTPUT (Foundation):")
            logger.info(json.dumps(foundation, indent=2))
            logger.info("=" * 80)

            # STAGE 2: Scene Segmentation (Visual breakdown + Overlays)
            logger.info("Stage 2/5: Scene Segmentation (Visual + Overlays)...")
            segmentation = self._stage2_scene_segmentation(video_file_obj, foundation)
            logger.info(f"Stage 2 complete: {segmentation['totalScenes']} scenes detected")
            logger.info("=" * 80)
            logger.info("STAGE 2 OUTPUT (Segmentation):")
            logger.info(json.dumps(segmentation, indent=2))
            logger.info("=" * 80)

            # STAGE 3: Consolidation Analysis (Pattern detection)
            logger.info("Stage 3/5: Consolidation Analysis (Pattern detection)...")
            consolidation = self._stage3_consolidation_analysis(foundation, segmentation)
            logger.info(f"Stage 3 complete: Consolidate={consolidation['shouldConsolidate']}")
            logger.info("=" * 80)
            logger.info("STAGE 3 OUTPUT (Consolidation):")
            logger.info(json.dumps(consolidation, indent=2))
            logger.info("=" * 80)

            # STAGE 4: Element Strategy (Type decisions + Notes)
            logger.info("Stage 4/5: Element Strategy (Type decisions + Notes)...")
            strategy = self._stage4_element_strategy(foundation, segmentation, consolidation)
            logger.info(f"Stage 4 complete: {len(strategy['elementDecisions'])} element decisions made")
            logger.info("=" * 80)
            logger.info("STAGE 4 OUTPUT (Strategy):")
            logger.info(json.dumps(strategy, indent=2))
            logger.info("=" * 80)

            # STAGE 5: JSON Generation (Final assembly)
            logger.info("Stage 5/5: JSON Generation (Final assembly)...")
            timeline_json = self._stage5_json_generation(foundation, segmentation, consolidation, strategy)
            logger.info(f"Stage 5 complete: Generated timeline with {len(timeline_json['timeline']['elements'])} elements")
            logger.info("=" * 80)
            logger.info("STAGE 5 OUTPUT (Final JSON):")
            logger.info(json.dumps(timeline_json, indent=2))
            logger.info("=" * 80)

            # Add metadata from all stages
            if 'metadata' not in timeline_json:
                timeline_json['metadata'] = {}

            timeline_json['metadata']['multiStageAnalysis'] = {
                'foundation': foundation,
                'segmentation': segmentation,
                'consolidation': consolidation,
                'strategy': strategy,
                'summary': {
                    'videoType': foundation['videoType'],
                    'totalScenes': segmentation['totalScenes'],
                    'shouldConsolidate': consolidation['shouldConsolidate'],
                    'consolidatedGroups': len(consolidation.get('consolidationGroups', [])),
                    'totalDecisions': len(strategy['elementDecisions'])
                }
            }

            # Clean up Gemini file
            genai.delete_file(video_file_obj.name)
            logger.info("Analysis complete and file cleaned up")

            return timeline_json

        except Exception as e:
            logger.error(f"Error analyzing video: {str(e)}")
            raise Exception(f"Failed to analyze video: {str(e)}")

        finally:
            # Clean up temporary file
            if temp_video_path and os.path.exists(temp_video_path):
                try:
                    os.remove(temp_video_path)
                    logger.info(f"Cleaned up temp video: {temp_video_path}")
                except Exception as e:
                    logger.warning(f"Failed to clean up temp video: {e}")

    def _save_temp_video(self, video_file):
        """Save uploaded video to temporary file"""
        suffix = os.path.splitext(video_file.name)[1] or '.mp4'
        temp_fd, temp_path = tempfile.mkstemp(suffix=suffix)

        with os.fdopen(temp_fd, 'wb') as f:
            for chunk in video_file.chunks():
                f.write(chunk)

        return temp_path

    def _stage1_foundation_analysis(self, video_file_obj):
        """
        Stage 1: Foundation Analysis
        Extract transcript, context, and overall understanding
        """
        prompt = """Analyze this video and provide foundation information.

**YOUR TASK:**
Extract the complete transcript, understand the context, and identify the overall structure.

**OUTPUT AS JSON:**
{
  "videoType": "product-demo|tutorial|promotional|explainer|interview|other",
  "description": "Brief 1-2 sentence description of what this video is about",
  "totalDuration": <seconds>,
  "transcript": [
    {
      "start": 0,
      "end": 2.5,
      "text": "Exact words spoken here",
      "speaker": "main|secondary|narrator|...",
      "confidence": "high|medium|low"
    }
  ],
  "subjects": {
    "main": {
      "type": "person|product|concept|screen",
      "description": "Detailed description",
      "role": "presenter|instructor|narrator|..."
    }
  },
  "audioCharacteristics": {
    "backgroundMusic": true|false,
    "soundEffects": [],
    "voiceTone": "Description of voice tone and style",
    "narrationStyle": "first-person|second-person|third-person|voice-over|..."
  },
  "overallPattern": "talking-head|intercut-promotional|tutorial|linear|multi-subject|...",
  "keyThemes": ["theme1", "theme2", "..."]
}

**CRITICAL REQUIREMENTS:**
- Transcribe EVERY spoken word with EXACT timing (to 0.1 second)
- If no speech, set transcript to empty array []
- Identify the main subject that appears in the video
- Classify the video type accurately
- Describe the overall pattern/structure

**CRITICAL OUTPUT FORMAT:**
- Return ONLY valid JSON
- NO markdown code blocks (no ```)
- NO comments (no // or /* */)
- NO trailing commas
- NO explanations before or after the JSON

Generate the JSON now."""

        response = self.model.generate_content([video_file_obj, prompt])
        return self._parse_json_response(response.text)

    def _stage2_scene_segmentation(self, video_file_obj, foundation):
        """
        Stage 2: Scene Segmentation
        Break video into precise scenes with overlays
        """
        prompt = f"""Analyze this video and break it into precise scenes.

**FOUNDATION CONTEXT:**
{json.dumps(foundation, indent=2)}

**YOUR TASK:**
Identify every scene cut, transition, or significant visual change. Include overlay detection.

**OUTPUT AS JSON:**
{{
  "totalScenes": <count>,
  "scenes": [
    {{
      "id": "scene-1",
      "start": 0,
      "end": 2.5,
      "duration": 2.5,
      "type": "main-subject|b-roll|graphic|text-overlay|product-shot|screen-recording|...",
      "visualContent": {{
        "description": "Detailed visual description",
        "subject": "main-presenter|product|graphic|...",
        "cameraAngle": "medium-shot|close-up|wide-shot|static|panning|...",
        "lighting": "bright|dim|natural|professional|...",
        "setting": "office|studio|outdoor|..."
      }},
      "audioContent": {{
        "hasDialogue": true|false,
        "transcriptText": "Words spoken in this scene (if any)",
        "backgroundAudio": "music|effects|silence|..."
      }},
      "overlays": {{
        "hasTextOverlay": true|false,
        "textContent": "Exact text if present",
        "hasImageOverlay": true|false,
        "overlayDescription": "Description if present"
      }},
      "transitionIn": "cut|fade|dissolve|wipe|none",
      "transitionOut": "cut|fade|dissolve|wipe|none"
    }}
  ],
  "patterns": {{
    "repeatedSubjects": {{
      "subject-id": [
        {{"sceneId": "scene-1", "duration": 2}},
        {{"sceneId": "scene-3", "duration": 1}}
      ]
    }},
    "intercutDetected": true|false
  }}
}}

**CRITICAL REQUIREMENTS:**
- Identify EVERY visual cut or significant change
- Timing must be PRECISE to 0.1 second
- scenes array must be in chronological order
- Sum of all scene durations must equal totalDuration
- Detect text and image overlays accurately
- Identify which subjects appear multiple times

**CRITICAL OUTPUT FORMAT:**
- Return ONLY valid JSON
- NO markdown code blocks (no ```)
- NO comments (no // or /* */)
- NO trailing commas
- NO explanations before or after the JSON

Generate the JSON now."""

        response = self.model.generate_content([video_file_obj, prompt])
        return self._parse_json_response(response.text)

    def _stage3_consolidation_analysis(self, foundation, segmentation):
        """
        Stage 3: Consolidation Analysis
        Determine if and how to consolidate repeated subjects
        """
        prompt = f"""Analyze whether this video should use consolidation for repeated subjects.

**FOUNDATION CONTEXT:**
{json.dumps(foundation, indent=2)}

**SEGMENTATION CONTEXT:**
{json.dumps(segmentation, indent=2)}

**YOUR TASK:**
Determine if the same subject appears multiple times with other content between. If yes, plan consolidation.

**CONSOLIDATION RULES:**
1. If same subject appears 3+ times with interruptions → MUST consolidate
2. If intercut pattern detected (Subject → Other → Subject) → MUST consolidate
3. If same speaker voice continues across segments → MUST consolidate

**OUTPUT AS JSON:**
{{
  "shouldConsolidate": true|false,
  "consolidationGroups": [
    {{
      "groupId": "main-speaker",
      "subjectType": "person|narrator|...",
      "sceneIds": ["scene-1", "scene-3", "scene-5"],
      "totalDuration": 7,
      "soraRoundedDuration": 8,
      "fullScript": "Complete transcript for all consolidated scenes",
      "trimRanges": [
        {{"sceneId": "scene-1", "start": 0, "end": 2}},
        {{"sceneId": "scene-3", "start": 2, "end": 3}},
        {{"sceneId": "scene-5", "start": 3, "end": 5}}
      ],
      "reasoning": "Why consolidation is needed"
    }}
  ],
  "nonConsolidatedScenes": ["scene-2", "scene-4"],
  "overallStrategy": "Description of the consolidation strategy"
}}

**CRITICAL REQUIREMENTS:**
- Detect ALL patterns that require consolidation
- Calculate trim ranges as CUMULATIVE within the generated video
- Round to Sora durations: 4s, 8s, or 12s
- Include FULL script from all consolidated scenes
- If no consolidation needed, set consolidationGroups to []

**CRITICAL OUTPUT FORMAT:**
- Return ONLY valid JSON
- NO markdown code blocks (no ```)
- NO comments (no // or /* */)
- NO trailing commas
- NO explanations before or after the JSON

Generate the JSON now."""

        response = self.model.generate_content(prompt)
        return self._parse_json_response(response.text)

    def _stage4_element_strategy(self, foundation, segmentation, consolidation):
        """
        Stage 4: Element Strategy
        Decide element types and write detailed notes
        """
        prompt = f"""Make strategic decisions about how to recreate each scene using AI.

**FOUNDATION:**
{json.dumps(foundation, indent=2)}

**SEGMENTATION:**
{json.dumps(segmentation, indent=2)}

**CONSOLIDATION:**
{json.dumps(consolidation, indent=2)}

**YOUR TASK:**
For each scene, decide:
1. Element type: ai-video, ai-image, or user-upload (image/video)
2. Why this choice was made (trade-offs)
3. How to write the prompt
4. Detailed notes explaining the decision

**ELEMENT TYPE GUIDELINES:**
- **ai-video**: Scenes with motion, speaking, or action. Can be recreated generically.
- **ai-image**: Static scenes, title cards, graphics. No motion needed.
- **user-upload (image)**: Specific logos, branding, exact products that must be uploaded.
- **user-upload (video)**: Specific screen recordings, exact footage that can't be recreated.

**TRADE-OFF CONSIDERATIONS:**
- Cost: ai-video > ai-image > user-upload
- Accuracy: user-upload > ai-video/ai-image
- Speed: ai-image > ai-video > user-upload
- Convenience: ai-* > user-upload

**OUTPUT AS JSON:**
{{
  "elementDecisions": [
    {{
      "sceneId": "scene-1",
      "elementType": "ai-video|ai-image|user-upload-image|user-upload-video",
      "isConsolidated": true|false,
      "consolidationGroupId": "main-speaker|null",
      "isSourceElement": true|false,
      "reasoning": "Why this element type was chosen",
      "tradeoffs": {{
        "considered": ["option1: pros/cons", "option2: pros/cons"],
        "chosen": "ai-video",
        "chosenReason": "Detailed explanation"
      }},
      "promptStrategy": "How to write the AI prompt for best results",
      "notes": "1-3 sentences explaining the decision for the user",
      "userUploadRequirements": "If user-upload: exact specs (format, dimensions, content)"
    }}
  ],
  "overallStrategy": {{
    "totalElements": 8,
    "aiVideoCount": 3,
    "aiImageCount": 2,
    "userUploadCount": 1,
    "consolidatedGroups": 1,
    "estimatedCost": "Rough estimate"
  }}
}}

**CRITICAL REQUIREMENTS:**
- Make a decision for EVERY scene from segmentation
- Notes field must be 1-3 sentences, user-friendly
- For consolidated scenes, mark which is the source element
- Explain trade-offs clearly
- Be honest about limitations

**CRITICAL OUTPUT FORMAT:**
- Return ONLY valid JSON
- NO markdown code blocks (no ```)
- NO comments (no // or /* */)
- NO trailing commas
- NO explanations before or after the JSON

Generate the JSON now."""

        response = self.model.generate_content(prompt)
        return self._parse_json_response(response.text)

    def _stage5_json_generation(self, foundation, segmentation, consolidation, strategy):
        """
        Stage 5: JSON Generation
        Assemble the final timeline JSON
        """
        prompt = f"""Generate the final timeline JSON using all previous analysis.

**ALL ANALYSIS DATA:**

Foundation:
{json.dumps(foundation, indent=2)}

Segmentation:
{json.dumps(segmentation, indent=2)}

Consolidation:
{json.dumps(consolidation, indent=2)}

Strategy:
{json.dumps(strategy, indent=2)}

**YOUR TASK:**
Create the timeline JSON following this exact structure:

{{
  "version": "1.0",
  "canvas": {{"width": 200, "height": 356, "aspectRatio": "9:16"}},
  "timeline": {{
    "totalDuration": <from foundation>,
    "elements": [
      {{
        "id": "element-1",
        "type": "ai-video|ai-image|image|video|pool",
        "duration": <from scene duration>,
        "mediaReference": null,
        "poolReference": null,
        "poolName": null,
        "poolType": null,
        "aiVideoConfig": {{
          "prompt": "For source elements: Full detailed prompt with complete script",
          "sourceReference": "For consolidated elements: reference to source element ID",
          "model": "sora-2",
          "duration": <full consolidated duration, NOT trim duration>,
          "inputImageData": null
        }},
        "aiImageConfig": {{
          "prompt": "Detailed image description",
          "model": "dall-e-3",
          "imageSize": "1024x1792"
        }},
        "shouldLoop": false,
        "videoStartTime": <cumulative start time>,
        "videoSource": "For consolidated: group ID like 'main-speaker', otherwise null",
        "videoTrim": "For consolidated: {{'start': X, 'end': Y}}, otherwise null",
        "notes": "<from strategy.notes field>"
      }}
    ],
    "edits": []
  }},
  "variables": {{"pools": []}},
  "metadata": {{
    "created": "<ISO_TIMESTAMP>",
    "pixelPerSecond": 40,
    "maxDuration": <totalDuration>
  }}
}}

**CRITICAL RULES:**
1. **For consolidated elements:**
   - First element (source): Include full prompt with complete script
   - First element: Include videoSource, videoTrim for first segment
   - Subsequent elements: MUST include sourceReference to first element's ID
   - Subsequent elements: Set prompt to null (or omit it entirely)
   - Subsequent elements: Use same videoSource, different videoTrim
   - aiVideoConfig.duration is the FULL consolidated video duration (same across all)
   - element.duration is the trim length (different for each)

   EXAMPLE of subsequent consolidated element:
   {{
     "id": "element-3",
     "type": "ai-video",
     "duration": 1,
     "aiVideoConfig": {{
       "sourceReference": "element-1",  // REQUIRED - reference to first element
       "model": "sora-2",
       "duration": 8.5  // Same as source
     }},
     "videoSource": "main-presenter",  // Same as source
     "videoTrim": {{"start": 2.3, "end": 3.6}}  // Different range
   }}

2. **For non-consolidated ai-video:**
   - Include prompt
   - NO sourceReference
   - NO videoSource or videoTrim

3. **For ai-image:**
   - Use aiImageConfig, set aiVideoConfig to null
   - Include detailed prompt

4. **For user-upload (type: image or video):**
   - Set both aiVideoConfig and aiImageConfig to null
   - mediaReference should be null (user will upload)

5. **Timing:**
   - videoStartTime is cumulative (0, then 2, then 5, etc.)
   - Sum of all durations must equal totalDuration

6. **Notes:**
   - EVERY element must have notes from strategy

**ABSOLUTELY CRITICAL - DO NOT FORGET:**
For ANY element that has videoSource and is NOT the first element with that videoSource:
- You MUST include "sourceReference": "<id-of-first-element>"
- Example: If element-1 has videoSource="main-presenter", then element-3, element-5, etc. MUST have "sourceReference": "element-1"
- This is NOT optional - the video export will FAIL without it

**CRITICAL OUTPUT FORMAT:**
- Return ONLY valid JSON
- NO markdown code blocks (no ```)
- NO comments (no // or /* */)
- NO trailing commas
- NO explanations before or after the JSON

Generate the JSON now."""

        response = self.model.generate_content(prompt)
        timeline_json = self._parse_json_response(response.text)

        # Validate structure
        self._validate_json_structure(timeline_json)

        # POST-PROCESSING FIX: Auto-add missing sourceReference fields
        self._fix_missing_source_references(timeline_json)

        return timeline_json

    def _parse_json_response(self, response_text):
        """Parse Gemini's JSON response with aggressive cleaning"""
        try:
            # Clean the response - remove markdown code blocks if present
            cleaned = response_text.strip()

            if cleaned.startswith('```json'):
                cleaned = cleaned[7:]
            elif cleaned.startswith('```'):
                cleaned = cleaned[3:]

            if cleaned.endswith('```'):
                cleaned = cleaned[:-3]

            cleaned = cleaned.strip()

            # Remove JavaScript-style comments (// comments)
            import re
            cleaned = re.sub(r'//.*?$', '', cleaned, flags=re.MULTILINE)

            # Remove trailing commas before closing braces/brackets
            # This fixes: {"key": "value",} or ["item1", "item2",]
            cleaned = re.sub(r',\s*([}\]])', r'\1', cleaned)

            # Try to parse JSON
            return json.loads(cleaned)

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Gemini response as JSON: {e}")
            logger.error(f"Error at line {e.lineno}, column {e.colno}")

            # Log the problematic area
            lines = cleaned.split('\n')
            if e.lineno <= len(lines):
                start = max(0, e.lineno - 3)
                end = min(len(lines), e.lineno + 2)
                logger.error("Context around error:")
                for i in range(start, end):
                    prefix = ">>> " if i == e.lineno - 1 else "    "
                    logger.error(f"{prefix}{i+1}: {lines[i]}")

            logger.error(f"Full cleaned response (first 1000 chars): {cleaned[:1000]}...")
            raise Exception(f"Gemini returned invalid JSON: {str(e)}")

    def _validate_json_structure(self, timeline_json):
        """Validate that the generated JSON has the correct structure"""
        required_fields = ['version', 'canvas', 'timeline', 'variables', 'metadata']
        for field in required_fields:
            if field not in timeline_json:
                raise Exception(f"Missing required field in JSON: {field}")

        # Validate timeline structure
        timeline = timeline_json.get('timeline', {})
        if 'elements' not in timeline:
            raise Exception("Missing 'elements' in timeline")

        if 'totalDuration' not in timeline:
            raise Exception("Missing 'totalDuration' in timeline")

        # Validate elements
        elements = timeline.get('elements', [])
        if not elements:
            raise Exception("No elements found in timeline")

        total_duration = 0
        for i, element in enumerate(elements):
            # Check required fields
            required_element_fields = ['id', 'type', 'duration', 'notes']
            for field in required_element_fields:
                if field not in element:
                    raise Exception(f"Element {i} missing required field: {field}")

            # Validate element type
            valid_types = ['ai-video', 'ai-image', 'image', 'video', 'pool']
            if element['type'] not in valid_types:
                raise Exception(f"Element {i} has invalid type: {element['type']}")

            # Validate AI configs
            if element['type'] == 'ai-video' and not element.get('aiVideoConfig'):
                raise Exception(f"Element {i} is ai-video but missing aiVideoConfig")

            if element['type'] == 'ai-image' and not element.get('aiImageConfig'):
                raise Exception(f"Element {i} is ai-image but missing aiImageConfig")

            total_duration += element['duration']

        # Validate total duration matches
        declared_duration = timeline.get('totalDuration')
        if abs(declared_duration - total_duration) > 0.1:
            logger.warning(f"Total duration mismatch: declared={declared_duration}, calculated={total_duration}")
            # Fix it automatically
            timeline_json['timeline']['totalDuration'] = total_duration
            timeline_json['metadata']['maxDuration'] = total_duration

        logger.info(f"JSON validation passed: {len(elements)} elements, {total_duration}s total duration")

    def _fix_missing_source_references(self, timeline_json):
        """
        POST-PROCESSING FIX: Automatically add missing sourceReference fields
        to consolidated elements that have videoSource but no sourceReference.

        This is a safety net because Gemini keeps failing to include sourceReference
        despite explicit prompts.
        """
        elements = timeline_json['timeline']['elements']

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

                logger.info(f"Processing videoSource group '{video_source}': {len(group_elements)} elements")
                logger.info(f"  Source element: {source_id}")

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
                        logger.info(f"  ✓ Auto-added sourceReference to {element_id} → {source_id}")
                    else:
                        logger.info(f"  ✓ {element_id} already has sourceReference: {element['aiVideoConfig']['sourceReference']}")

        if fixes_applied > 0:
            logger.warning(f"⚠️  POST-PROCESSING: Added {fixes_applied} missing sourceReference fields")
            logger.warning(f"⚠️  This means Gemini failed to include them despite explicit prompts")
        else:
            logger.info("✓ No missing sourceReference fields - Gemini did it correctly!")

        return timeline_json
