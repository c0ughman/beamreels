import json
import logging
from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from .video_export_service import VideoExportService
from .gemini_multi_stage_analyzer import GeminiMultiStageAnalyzer

logger = logging.getLogger(__name__)


def landing_page(request):
    """Landing page view"""
    return render(request, 'core/landing.html')


def creator_page(request):
    """Video template creator interface"""
    return render(request, 'core/creator.html')


@csrf_exempt
@require_http_methods(["POST"])
def creator_export_video(request):
    """Export video from creator timeline"""
    try:
        data = json.loads(request.body)
        timeline_data = data.get('timeline')
        video_count = data.get('videoCount', 1)

        if not timeline_data:
            return JsonResponse({'error': 'timeline is required'}, status=400)

        # Validate video count
        video_count = min(max(1, video_count), 10)  # Limit between 1-10

        logger.info(f"Starting video export: {video_count} video(s)")
        logger.info(f"Timeline data: {timeline_data}")

        # Log AI video and AI image elements specifically
        for i, element in enumerate(timeline_data.get('elements', [])):
            if element.get('type') == 'ai-video':
                logger.info(f"AI Video element {i}: {element}")
            elif element.get('type') == 'ai-image':
                logger.info(f"AI Image element {i}: {element}")

        # Import and use video export service
        export_service = VideoExportService()

        # Generate videos
        logger.info("Calling export_multiple_videos...")
        results = export_service.export_multiple_videos(timeline_data, video_count)
        logger.info(f"Export returned: {results}")

        if not results:
            return JsonResponse({'error': 'Failed to generate videos'}, status=500)

        logger.info(f"Successfully generated {len(results)} video(s)")

        # Extract video URLs for backward compatibility
        video_urls = [r['videoUrl'] for r in results]

        return JsonResponse({
            'success': True,
            'videos': video_urls,
            'results': results,  # Include full results with AI content metadata
            'count': len(results)
        })

    except Exception as e:
        logger.error(f"Video export error: {str(e)}")
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def creator_import_video(request):
    """Import video and generate timeline JSON using Gemini"""
    try:
        # Get uploaded video file
        video_file = request.FILES.get('video')

        if not video_file:
            return JsonResponse({'error': 'video file is required'}, status=400)

        # Validate file type
        allowed_types = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/mpeg', 'video/webm']
        if video_file.content_type not in allowed_types:
            return JsonResponse({
                'error': f'Invalid file type: {video_file.content_type}. Allowed types: MP4, MOV, AVI, MPEG, WebM'
            }, status=400)

        # Validate file size (max 100MB)
        max_size = 100 * 1024 * 1024  # 100MB
        if video_file.size > max_size:
            return JsonResponse({
                'error': f'File too large: {video_file.size / (1024*1024):.1f}MB. Maximum allowed: 100MB'
            }, status=400)

        logger.info(f"Processing video import: {video_file.name} ({video_file.size / (1024*1024):.1f}MB)")

        # Use multi-stage analyzer
        logger.info("Using multi-stage analyzer (5 stages)")
        analyzer = GeminiMultiStageAnalyzer()

        timeline_json = analyzer.analyze_video_and_generate_json(video_file)

        logger.info(f"Video analysis complete. Generated timeline with {len(timeline_json['timeline']['elements'])} elements")

        return JsonResponse({
            'success': True,
            'timeline': timeline_json,
            'message': f"Successfully analyzed video and generated {len(timeline_json['timeline']['elements'])} timeline elements"
        })

    except Exception as e:
        logger.error(f"Video import error: {str(e)}")
        return JsonResponse({'error': str(e)}, status=500)

