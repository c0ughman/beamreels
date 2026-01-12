"""
Image utilities for Sora video generation
"""
from PIL import Image
import os
import tempfile
import logging

logger = logging.getLogger(__name__)


def resize_image_for_video(image_file, target_size):
    """
    Resize an uploaded image to match video dimensions
    
    Args:
        image_file: Django UploadedFile object
        target_size (str): Target size in format "1920x1080"
        
    Returns:
        str: Path to resized image file
        
    Raises:
        Exception: If image processing fails
    """
    try:
        # Parse target dimensions
        width, height = map(int, target_size.split('x'))
        logger.info(f"Target dimensions: {width}x{height}")
        
        # Open the uploaded image
        img = Image.open(image_file)
        original_size = img.size
        logger.info(f"Original image size: {original_size[0]}x{original_size[1]}")
        
        # Check if resize is needed
        if img.size == (width, height):
            logger.info("Image already matches target size, no resize needed")
            # Still need to save to temp file
            temp_dir = tempfile.gettempdir()
            temp_path = os.path.join(temp_dir, f"sora_resized_{os.path.basename(image_file.name)}")
            img.save(temp_path)
            return temp_path
        
        # Resize image to exact dimensions
        logger.info(f"Resizing from {original_size[0]}x{original_size[1]} to {width}x{height}")
        resized_img = img.resize((width, height), Image.Resampling.LANCZOS)
        
        # Convert to RGB if needed (for JPEG compatibility)
        if resized_img.mode in ('RGBA', 'P'):
            # Create white background
            rgb_img = Image.new('RGB', resized_img.size, (255, 255, 255))
            if resized_img.mode == 'RGBA':
                rgb_img.paste(resized_img, mask=resized_img.split()[3])  # Use alpha channel as mask
            else:
                rgb_img.paste(resized_img)
            resized_img = rgb_img
        
        # Save to temp file
        temp_dir = tempfile.gettempdir()
        file_ext = os.path.splitext(image_file.name)[1] or '.jpg'
        temp_path = os.path.join(temp_dir, f"sora_resized_{os.path.basename(image_file.name)}")
        
        # Save with appropriate format
        if file_ext.lower() in ['.jpg', '.jpeg']:
            resized_img.save(temp_path, 'JPEG', quality=95)
        elif file_ext.lower() == '.png':
            resized_img.save(temp_path, 'PNG')
        elif file_ext.lower() == '.webp':
            resized_img.save(temp_path, 'WEBP', quality=95)
        else:
            # Default to JPEG
            resized_img.save(temp_path, 'JPEG', quality=95)
        
        logger.info(f"Image resized and saved to: {temp_path}")
        logger.info(f"New size: {width}x{height}")
        
        return temp_path
        
    except Exception as e:
        logger.error(f"Error resizing image: {str(e)}")
        raise Exception(f"Failed to resize image: {str(e)}")


def validate_image_format(image_file):
    """
    Validate that the image is in a supported format
    
    Args:
        image_file: Django UploadedFile object
        
    Returns:
        bool: True if valid, raises exception if not
    """
    try:
        img = Image.open(image_file)
        
        # Check format
        if img.format not in ['JPEG', 'PNG', 'WEBP']:
            raise ValueError(f"Unsupported image format: {img.format}. Use JPEG, PNG, or WebP.")
        
        logger.info(f"Image format validated: {img.format}, Size: {img.size}")
        
        # Reset file pointer for later use
        image_file.seek(0)
        
        return True
        
    except Exception as e:
        logger.error(f"Image validation failed: {str(e)}")
        raise Exception(f"Invalid image: {str(e)}")

