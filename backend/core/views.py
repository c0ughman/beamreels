import json
import logging
import uuid
from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from .video_export_service import VideoExportService
from .gemini_multi_stage_analyzer import GeminiMultiStageAnalyzer
from .models import Template, MediaLibrary

logger = logging.getLogger(__name__)


def landing_page(request):
    return render(request, 'core/landing.html')


def creator_page(request):
    return render(request, 'core/creator.html')


@csrf_exempt
@require_http_methods(["POST"])
def creator_export_video(request):
    try:
        data = json.loads(request.body)
        timeline_data = data.get('timeline')
        video_count = data.get('videoCount', 1)

        if not timeline_data:
            return JsonResponse({'error': 'timeline is required'}, status=400)

        video_count = min(max(1, video_count), 10)

        logger.info(f"Starting video export: {video_count} video(s)")
        logger.info(f"Timeline data: {timeline_data}")

        for i, element in enumerate(timeline_data.get('elements', [])):
            if element.get('type') == 'ai-video':
                logger.info(f"AI Video element {i}: {element}")
            elif element.get('type') == 'ai-image':
                logger.info(f"AI Image element {i}: {element}")

        export_service = VideoExportService()

        logger.info("Calling export_multiple_videos...")
        results = export_service.export_multiple_videos(timeline_data, video_count)
        logger.info(f"Export returned: {results}")

        if not results:
            return JsonResponse({'error': 'Failed to generate videos'}, status=500)

        logger.info(f"Successfully generated {len(results)} video(s)")

        video_urls = [r['videoUrl'] for r in results]

        return JsonResponse({
            'success': True,
            'videos': video_urls,
            'results': results,
            'count': len(results)
        })

    except Exception as e:
        logger.error(f"Video export error: {str(e)}")
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def creator_import_video(request):
    try:
        video_file = request.FILES.get('video')

        if not video_file:
            return JsonResponse({'error': 'video file is required'}, status=400)

        allowed_types = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/mpeg', 'video/webm']
        if video_file.content_type not in allowed_types:
            return JsonResponse({
                'error': f'Invalid file type: {video_file.content_type}. Allowed types: MP4, MOV, AVI, MPEG, WebM'
            }, status=400)

        max_size = 100 * 1024 * 1024
        if video_file.size > max_size:
            return JsonResponse({
                'error': f'File too large: {video_file.size / (1024*1024):.1f}MB. Maximum allowed: 100MB'
            }, status=400)

        logger.info(f"Processing video import: {video_file.name} ({video_file.size / (1024*1024):.1f}MB)")

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


@csrf_exempt
@require_http_methods(["GET"])
def get_templates(request):
    device_id = request.GET.get('device_id')
    if not device_id:
        return JsonResponse({'error': 'device_id is required'}, status=400)

    templates = Template.objects.filter(device_id=device_id).order_by('-updated_at')
    data = [{
        'id': str(t.id),
        'device_id': t.device_id,
        'name': t.name,
        'thumbnail': t.thumbnail,
        'timeline_data': t.timeline_data,
        'exports_count': t.exports_count,
        'created_at': t.created_at.isoformat(),
        'updated_at': t.updated_at.isoformat()
    } for t in templates]

    return JsonResponse({'data': data})


@csrf_exempt
@require_http_methods(["GET"])
def get_template(request, template_id):
    device_id = request.GET.get('device_id')
    if not device_id:
        return JsonResponse({'error': 'device_id is required'}, status=400)

    try:
        template = Template.objects.get(id=template_id, device_id=device_id)
        return JsonResponse({
            'data': {
                'id': str(template.id),
                'device_id': template.device_id,
                'name': template.name,
                'thumbnail': template.thumbnail,
                'timeline_data': template.timeline_data,
                'exports_count': template.exports_count,
                'created_at': template.created_at.isoformat(),
                'updated_at': template.updated_at.isoformat()
            }
        })
    except Template.DoesNotExist:
        return JsonResponse({'data': None})


@csrf_exempt
@require_http_methods(["POST"])
def create_template(request):
    try:
        data = json.loads(request.body)
        device_id = data.get('device_id')
        if not device_id:
            return JsonResponse({'error': 'device_id is required'}, status=400)

        template_id = data.get('id')
        if template_id:
            try:
                template_id = uuid.UUID(template_id)
            except ValueError:
                template_id = uuid.uuid4()
        else:
            template_id = uuid.uuid4()

        template = Template.objects.create(
            id=template_id,
            device_id=device_id,
            name=data.get('name', 'Untitled Template'),
            thumbnail=data.get('thumbnail'),
            timeline_data=data.get('timeline_data', {'elements': [], 'overlays': [], 'variablePools': {}}),
            exports_count=data.get('exports_count', 0)
        )

        return JsonResponse({
            'data': {
                'id': str(template.id),
                'device_id': template.device_id,
                'name': template.name,
                'thumbnail': template.thumbnail,
                'timeline_data': template.timeline_data,
                'exports_count': template.exports_count,
                'created_at': template.created_at.isoformat(),
                'updated_at': template.updated_at.isoformat()
            }
        })
    except Exception as e:
        logger.error(f"Create template error: {str(e)}")
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@require_http_methods(["PUT"])
def update_template(request, template_id):
    try:
        data = json.loads(request.body)
        device_id = data.get('device_id')
        if not device_id:
            return JsonResponse({'error': 'device_id is required'}, status=400)

        try:
            template = Template.objects.get(id=template_id, device_id=device_id)
        except Template.DoesNotExist:
            return JsonResponse({'error': 'Template not found'}, status=404)

        if 'name' in data:
            template.name = data['name']
        if 'thumbnail' in data:
            template.thumbnail = data['thumbnail']
        if 'timeline_data' in data:
            template.timeline_data = data['timeline_data']
        if 'exports_count' in data:
            template.exports_count = data['exports_count']

        template.save()

        return JsonResponse({
            'data': {
                'id': str(template.id),
                'device_id': template.device_id,
                'name': template.name,
                'thumbnail': template.thumbnail,
                'timeline_data': template.timeline_data,
                'exports_count': template.exports_count,
                'created_at': template.created_at.isoformat(),
                'updated_at': template.updated_at.isoformat()
            }
        })
    except Exception as e:
        logger.error(f"Update template error: {str(e)}")
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@require_http_methods(["DELETE"])
def delete_template(request, template_id):
    device_id = request.GET.get('device_id')
    if not device_id:
        return JsonResponse({'error': 'device_id is required'}, status=400)

    try:
        template = Template.objects.get(id=template_id, device_id=device_id)
        template.delete()
        return JsonResponse({'success': True})
    except Template.DoesNotExist:
        return JsonResponse({'error': 'Template not found'}, status=404)


@csrf_exempt
@require_http_methods(["GET"])
def get_media_items(request):
    device_id = request.GET.get('device_id')
    if not device_id:
        return JsonResponse({'error': 'device_id is required'}, status=400)

    type_filter = request.GET.get('type')
    queryset = MediaLibrary.objects.filter(device_id=device_id)

    if type_filter and type_filter != 'all':
        queryset = queryset.filter(type=type_filter)

    data = [{
        'id': str(m.id),
        'device_id': m.device_id,
        'name': m.name,
        'type': m.type,
        'files': m.files,
        'created_at': m.created_at.isoformat()
    } for m in queryset]

    return JsonResponse({'data': data})


@csrf_exempt
@require_http_methods(["POST"])
def create_media_item(request):
    try:
        data = json.loads(request.body)
        device_id = data.get('device_id')
        if not device_id:
            return JsonResponse({'error': 'device_id is required'}, status=400)

        media_item = MediaLibrary.objects.create(
            device_id=device_id,
            name=data.get('name', 'Untitled Pool'),
            type=data.get('type', 'image_pool'),
            files=data.get('files', [])
        )

        return JsonResponse({
            'data': {
                'id': str(media_item.id),
                'device_id': media_item.device_id,
                'name': media_item.name,
                'type': media_item.type,
                'files': media_item.files,
                'created_at': media_item.created_at.isoformat()
            }
        })
    except Exception as e:
        logger.error(f"Create media item error: {str(e)}")
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@require_http_methods(["DELETE"])
def delete_media_item(request, media_id):
    device_id = request.GET.get('device_id')
    if not device_id:
        return JsonResponse({'error': 'device_id is required'}, status=400)

    try:
        media_item = MediaLibrary.objects.get(id=media_id, device_id=device_id)
        media_item.delete()
        return JsonResponse({'success': True})
    except MediaLibrary.DoesNotExist:
        return JsonResponse({'error': 'Media item not found'}, status=404)
