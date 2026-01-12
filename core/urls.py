from django.urls import path
from . import views

urlpatterns = [
    path('', views.landing_page, name='landing_page'),
    path('creator/', views.creator_page, name='creator_page'),
    path('api/creator/export/', views.creator_export_video, name='creator_export_video'),
    path('api/creator/import-video/', views.creator_import_video, name='creator_import_video'),
]

