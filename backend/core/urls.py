from django.urls import path
from . import views

urlpatterns = [
    path('', views.landing_page, name='landing_page'),
    path('creator/', views.creator_page, name='creator_page'),
    path('api/creator/export/', views.creator_export_video, name='creator_export_video'),
    path('api/creator/import-video/', views.creator_import_video, name='creator_import_video'),

    path('api/templates/', views.get_templates, name='get_templates'),
    path('api/templates/create/', views.create_template, name='create_template'),
    path('api/templates/<uuid:template_id>/', views.get_template, name='get_template'),
    path('api/templates/<uuid:template_id>/update/', views.update_template, name='update_template'),
    path('api/templates/<uuid:template_id>/delete/', views.delete_template, name='delete_template'),

    path('api/media/', views.get_media_items, name='get_media_items'),
    path('api/media/create/', views.create_media_item, name='create_media_item'),
    path('api/media/<uuid:media_id>/delete/', views.delete_media_item, name='delete_media_item'),
]
