import uuid
from django.db import models


class Template(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    device_id = models.CharField(max_length=100, db_index=True)
    name = models.CharField(max_length=255)
    thumbnail = models.TextField(blank=True, null=True)
    timeline_data = models.JSONField(default=dict)
    exports_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['device_id', '-updated_at']),
        ]

    def __str__(self):
        return self.name


class MediaLibrary(models.Model):
    TYPE_CHOICES = [
        ('image_pool', 'Image Pool'),
        ('video_pool', 'Video Pool'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    device_id = models.CharField(max_length=100, db_index=True)
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    files = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['device_id', '-created_at']),
        ]

    def __str__(self):
        return self.name
