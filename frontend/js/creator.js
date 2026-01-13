        // Configuration
        const BASE_WIDTH = 200; // 9:16 ratio
        const BASE_HEIGHT = 356;
        const PIXEL_PER_SECOND = 40; // 200px / 5 seconds = 40px per second
        const MAX_DURATION = 60;

        // API Configuration
        let currentTemplateId = null;
        let currentTemplate = null;
        let deviceId = null;
        let autoSaveTimeout = null;
        let isSaving = false;
        const AUTO_SAVE_DELAY = 2000;

        function getDeviceId() {
            let id = localStorage.getItem('beamreels_device_id');
            if (!id) {
                id = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                localStorage.setItem('beamreels_device_id', id);
            }
            return id;
        }

        function initApi() {
            deviceId = getDeviceId();
            currentTemplateId = localStorage.getItem('currentTemplateId');
            return true;
        }

        async function loadTemplateFromApi() {
            if (!currentTemplateId || !deviceId) return null;

            try {
                const response = await fetch(`${window.API_BASE_URL}/api/templates/${currentTemplateId}/?device_id=${deviceId}`);
                const result = await response.json();

                if (result.error) {
                    console.error('Error loading template:', result.error);
                    return null;
                }

                currentTemplate = result.data;
                return result.data;
            } catch (error) {
                console.error('Error loading template:', error);
                return null;
            }
        }

        async function saveTemplateToApi(showIndicator = true) {
            if (!currentTemplateId || !deviceId) return;
            if (isSaving) return;

            isSaving = true;
            const saveIndicator = document.getElementById('saveIndicator');

            if (showIndicator && saveIndicator) {
                saveIndicator.querySelector('.save-indicator-text').textContent = 'Saving...';
                saveIndicator.classList.remove('saved');
                saveIndicator.classList.add('visible', 'saving');
            }

            try {
                const timelineData = await collectTimelineDataForSave();
                const thumbnail = await generateTimelineThumbnail();

                const response = await fetch(`${window.API_BASE_URL}/api/templates/${currentTemplateId}/update/`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        device_id: deviceId,
                        timeline_data: timelineData,
                        thumbnail: thumbnail
                    })
                });

                const result = await response.json();

                if (result.error) {
                    console.error('Error saving template:', result.error);
                } else if (showIndicator && saveIndicator) {
                    saveIndicator.querySelector('.save-indicator-text').textContent = 'Saved';
                    saveIndicator.classList.remove('saving');
                    saveIndicator.classList.add('saved');
                    setTimeout(() => {
                        saveIndicator.classList.remove('visible');
                    }, 2000);
                }
            } catch (err) {
                console.error('Save error:', err);
            } finally {
                isSaving = false;
            }
        }

        function triggerAutoSave() {
            if (autoSaveTimeout) {
                clearTimeout(autoSaveTimeout);
            }
            autoSaveTimeout = setTimeout(() => {
                saveTemplateToApi();
            }, AUTO_SAVE_DELAY);
        }

        async function collectTimelineDataForSave() {
            const elementsRow = document.getElementById('elementsRow');
            const editTrack = document.getElementById('editTrack');

            const timelineElements = Array.from(elementsRow.querySelectorAll('.timeline-element')).filter(el => {
                const isFinalized = el.dataset.finalized === 'true';
                const hasType = el.dataset.type && el.dataset.type !== 'none';
                return isFinalized && hasType;
            });

            timelineElements.sort((a, b) => {
                return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
            });

            const elements = timelineElements.map(el => {
                const type = el.dataset.type;
                let mediaUrl = null;

                if (type === 'image') {
                    mediaUrl = el.dataset.imageData || null;
                } else if (type === 'video' && el.dataset.videoURL) {
                    mediaUrl = el.dataset.videoURL;
                }

                const poolData = el.dataset.poolData ? JSON.parse(el.dataset.poolData) : null;
                const aiVideoConfig = el.dataset.aiVideoConfig ? JSON.parse(el.dataset.aiVideoConfig) : null;
                const aiImageConfig = el.dataset.aiImageConfig ? JSON.parse(el.dataset.aiImageConfig) : null;

                return {
                    type: type,
                    duration: parseInt(el.dataset.duration) || 5,
                    mediaUrl: mediaUrl,
                    poolData: poolData,
                    poolName: el.dataset.poolName || null,
                    aiVideoConfig: aiVideoConfig,
                    aiImageConfig: aiImageConfig,
                    shouldLoop: el.dataset.shouldLoop === 'true',
                    videoStartTime: parseFloat(el.dataset.videoStartTime) || 0
                };
            });

            const editElements = Array.from(editTrack.querySelectorAll('.edit-element[data-finalized="true"]'));
            const overlays = editElements.map(editEl => {
                const overlayUrl = editEl.dataset.overlayUrl;
                if (!overlayUrl) return null;

                return {
                    overlayUrl: overlayUrl,
                    duration: parseInt(editEl.dataset.duration) || 5,
                    left: parseFloat(editEl.style.left) || 0
                };
            }).filter(o => o !== null);

            return {
                elements: elements,
                overlays: overlays,
                variablePools: variablePools || {}
            };
        }

        async function generateTimelineThumbnail() {
            const firstElement = document.querySelector('.timeline-element[data-finalized="true"]');
            if (!firstElement) return null;

            const type = firstElement.dataset.type;
            let thumbnail = null;

            if (type === 'image') {
                const imageData = firstElement.dataset.imageData;
                if (imageData) {
                    thumbnail = await resizeImage(imageData, 180, 320);
                }
            } else if (type === 'video') {
                const videoURL = firstElement.dataset.videoURL;
                if (videoURL) {
                    thumbnail = await extractVideoThumbnail(videoURL, 180, 320);
                }
            } else if (type === 'pool') {
                const poolData = firstElement.dataset.poolData ? JSON.parse(firstElement.dataset.poolData) : null;
                if (poolData && poolData.files && poolData.files[0] && poolData.files[0].data) {
                    thumbnail = await resizeImage(poolData.files[0].data, 180, 320);
                }
            }

            return thumbnail;
        }

        function resizeImage(dataUrl, maxWidth, maxHeight) {
            return new Promise(resolve => {
                if (!dataUrl || !dataUrl.startsWith('data:image')) {
                    resolve(null);
                    return;
                }
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = maxWidth;
                    canvas.height = maxHeight;
                    const ctx = canvas.getContext('2d');
                    const scale = Math.max(maxWidth / img.width, maxHeight / img.height);
                    const x = (maxWidth - img.width * scale) / 2;
                    const y = (maxHeight - img.height * scale) / 2;
                    ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
                    resolve(canvas.toDataURL('image/jpeg', 0.7));
                };
                img.onerror = () => resolve(null);
                img.src = dataUrl;
            });
        }

        function extractVideoThumbnail(videoUrl, maxWidth, maxHeight) {
            return new Promise(resolve => {
                const video = document.createElement('video');
                video.src = videoUrl;
                video.crossOrigin = 'anonymous';
                video.muted = true;
                video.onloadeddata = () => { video.currentTime = 0.5; };
                video.onseeked = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = maxWidth;
                    canvas.height = maxHeight;
                    const ctx = canvas.getContext('2d');
                    const scale = Math.max(maxWidth / video.videoWidth, maxHeight / video.videoHeight);
                    const x = (maxWidth - video.videoWidth * scale) / 2;
                    const y = (maxHeight - video.videoHeight * scale) / 2;
                    ctx.drawImage(video, x, y, video.videoWidth * scale, video.videoHeight * scale);
                    resolve(canvas.toDataURL('image/jpeg', 0.7));
                };
                video.onerror = () => resolve(null);
                setTimeout(() => resolve(null), 5000);
            });
        }

        async function applyTemplateToTimeline(timelineData) {
            if (!timelineData) return;

            const elementsRow = document.getElementById('elementsRow');
            const editTrack = document.getElementById('editTrack');

            if (timelineData.variablePools) {
                variablePools = Array.isArray(timelineData.variablePools)
                    ? timelineData.variablePools
                    : Object.values(timelineData.variablePools);
            }

            if (timelineData.elements && timelineData.elements.length > 0) {
                const initialElement = elementsRow.querySelector('.timeline-element');
                if (initialElement) {
                    initialElement.remove();
                }

                for (const elementData of timelineData.elements) {
                    await createElementFromData(elementData);
                }
            }

            if (timelineData.overlays && timelineData.overlays.length > 0) {
                for (const overlayData of timelineData.overlays) {
                    await createOverlayFromData(overlayData);
                }
            }
        }

        async function createElementFromData(data) {
            const elementsRow = document.getElementById('elementsRow');
            const newElement = document.createElement('div');
            newElement.className = 'timeline-element';
            newElement.dataset.type = data.type;
            newElement.dataset.duration = data.duration;
            newElement.dataset.elementId = nextElementId++;
            newElement.dataset.finalized = 'true';

            const width = data.duration * PIXEL_PER_SECOND;
            newElement.style.width = width + 'px';
            newElement.style.height = BASE_HEIGHT + 'px';

            if (data.mediaUrl) {
                if (data.type === 'image') {
                    newElement.dataset.imageData = data.mediaUrl;
                } else if (data.type === 'video') {
                    newElement.dataset.videoURL = data.mediaUrl;
                }
            }

            if (data.poolData) {
                newElement.dataset.poolData = JSON.stringify(data.poolData);
                newElement.dataset.poolName = data.poolName || '';
            }

            if (data.aiVideoConfig) {
                newElement.dataset.aiVideoConfig = JSON.stringify(data.aiVideoConfig);
            }

            if (data.aiImageConfig) {
                newElement.dataset.aiImageConfig = JSON.stringify(data.aiImageConfig);
            }

            if (data.shouldLoop) {
                newElement.dataset.shouldLoop = 'true';
            }

            if (data.videoStartTime) {
                newElement.dataset.videoStartTime = data.videoStartTime;
            }

            const innerContent = createElementInnerContent(data);
            newElement.innerHTML = innerContent;

            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            newElement.appendChild(resizeHandle);

            elementsRow.appendChild(newElement);
            setupElementHandlers(newElement);

            return newElement;
        }

        function createElementInnerContent(data) {
            let bgStyle = '';
            let labelText = '';

            switch (data.type) {
                case 'image':
                    if (data.mediaUrl) {
                        bgStyle = `background-image: url('${data.mediaUrl}'); background-size: cover; background-position: center;`;
                    } else {
                        bgStyle = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);';
                    }
                    labelText = 'Image';
                    break;
                case 'video':
                    bgStyle = 'background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);';
                    labelText = 'Video';
                    break;
                case 'pool':
                    if (data.poolData && data.poolData.files && data.poolData.files[0] && data.poolData.files[0].data) {
                        bgStyle = `background-image: url('${data.poolData.files[0].data}'); background-size: cover; background-position: center;`;
                    } else {
                        bgStyle = 'background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);';
                    }
                    labelText = data.poolName || 'Pool';
                    break;
                case 'ai-video':
                    bgStyle = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);';
                    labelText = 'AI Video';
                    break;
                case 'ai-image':
                    bgStyle = 'background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);';
                    labelText = 'AI Image';
                    break;
                default:
                    bgStyle = 'background: #e5e5e7;';
                    labelText = data.type;
            }

            return `
                <div class="element-content" style="${bgStyle}">
                    <div class="element-label">${labelText}</div>
                    <div class="element-duration">${data.duration}s</div>
                </div>
            `;
        }

        async function createOverlayFromData(data) {
            if (!data.overlayUrl) return null;

            const editTrack = document.getElementById('editTrack');
            const newEditElement = document.createElement('div');
            newEditElement.className = 'edit-element';
            newEditElement.dataset.duration = data.duration;
            newEditElement.dataset.finalized = 'true';
            newEditElement.dataset.overlayUrl = data.overlayUrl;

            const width = data.duration * PIXEL_PER_SECOND;
            newEditElement.style.width = width + 'px';
            newEditElement.style.left = (data.left || 0) + 'px';

            newEditElement.innerHTML = `
                <div class="edit-content">
                    <div class="edit-preview" style="background-image: url('${data.overlayUrl}'); background-size: cover; background-position: center;">
                        <span class="edit-label">Text</span>
                    </div>
                </div>
                <div class="resize-handle"></div>
            `;

            editTrack.appendChild(newEditElement);

            return newEditElement;
        }

        function setupElementHandlers(element) {
            element.addEventListener('click', (e) => {
                if (!e.target.classList.contains('resize-handle')) {
                    showElementForm(element, e);
                }
            });

            const resizeHandle = element.querySelector('.resize-handle');
            if (resizeHandle) {
                resizeHandle.addEventListener('mousedown', (e) => startResize(e, element));
            }
        }

        // Zoom Configuration
        let currentZoomMode = 'default'; // 'default', 'adaptive', 'fixed'
        const FIXED_ZOOM_OUT_FACTOR = 2.2; // 2.2x zoom out for fixed mode

        // State
        let elements = [];
        let nextElementId = 1;
        let isResizing = false;
        let resizingElement = null;
        let resizeStartX = 0;
        let resizeStartWidth = 0;
        let deletedElements = []; // Undo stack
        let currentToast = null;

        // Drag-to-reorder state
        let isDraggingElement = false;
        let draggingElement = null;
        let dragPlaceholder = null;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragOffsetX = 0;
        let autoScrollInterval = null;
        let autoScrollSpeed = 0;

        // Pool Management State
        let videoPools = [];
        let imagePools = [];
        let currentPoolType = null; // 'video' or 'image'
        let currentPoolFiles = []; // Files being added to new pool
        let activeDropdown = null; // Track which dropdown is for pool selection

        // Variable Pool Management State
        let variablePools = [];
        let nextVariablePoolId = 1;
        let activeVariableField = null; // Track which field is requesting a variable
        let dbInstance = null; // IndexedDB instance

        // AI Video State
        let currentAIVideoElement = null; // Element being configured
        let aiVideoInputImageData = null; // Stored image data for AI video

        // AI Image State
        let currentAIImageElement = null; // Element being configured

        // AI Video Modal Functions (defined early for access from showElementForm)
        function openAIVideoModal(existingConfig = null) {
            const aiVideoModal = document.getElementById('aiVideoModal');
            const aiVideoPrompt = document.getElementById('aiVideoPrompt');
            const aiVideoModel = document.getElementById('aiVideoModel');
            const aiVideoDuration = document.getElementById('aiVideoDuration');
            const aiVideoImage = document.getElementById('aiVideoImage');
            
            if (!aiVideoModal) {
                console.error('AI Video modal not found');
                return;
            }
            
            // Reset or populate form
            const preview = document.getElementById('aiVideoImagePreview');
            const previewImg = document.getElementById('aiVideoImagePreviewImg');
            
            if (existingConfig) {
                aiVideoPrompt.value = existingConfig.prompt || '';
                aiVideoModel.value = existingConfig.model || 'sora-2';
                aiVideoDuration.value = existingConfig.duration || '8';
                aiVideoInputImageData = existingConfig.inputImageData || null;
                
                // Show preview if image exists
                if (aiVideoInputImageData && preview && previewImg) {
                    previewImg.src = aiVideoInputImageData;
                    preview.style.display = 'block';
                    // Hide upload button text - for AI video modal, the input field is separate
                    const inputField = document.getElementById('aiVideoImage');
                    if (inputField && inputField.parentElement) {
                        const previewContainer = inputField.parentElement.querySelector('#aiVideoImagePreview');
                        if (previewContainer && previewContainer.style.display === 'block') {
                            // Text is already below the input, so we don't need to hide it
                        }
                    }
                } else if (preview) {
                    preview.style.display = 'none';
                }
            } else {
                aiVideoPrompt.value = '';
                aiVideoModel.value = 'sora-2';
                aiVideoDuration.value = '8';
                aiVideoImage.value = '';
                aiVideoInputImageData = null;
                if (preview) {
                    preview.style.display = 'none';
                }
            }
            
            aiVideoModal.classList.add('open');
        }

        function closeAIVideoModal() {
            const aiVideoModal = document.getElementById('aiVideoModal');
            if (aiVideoModal) {
                aiVideoModal.classList.remove('open');
            }
            currentAIVideoElement = null;
            aiVideoInputImageData = null;
        }

        // AI Image Modal Functions
        function openAIImageModal(existingConfig = null) {
            const aiImageModal = document.getElementById('aiImageModal');
            const aiImagePrompt = document.getElementById('aiImagePrompt');
            const aiImageModel = document.getElementById('aiImageModel');
            const aiImageQuality = document.getElementById('aiImageQuality');
            const aiImageFormat = document.getElementById('aiImageFormat');
            const aiImageCompression = document.getElementById('aiImageCompression');

            if (!aiImageModal) {
                console.error('AI Image modal not found');
                return;
            }

            // Reset or populate form
            if (existingConfig) {
                aiImagePrompt.value = existingConfig.prompt || '';
                aiImageModel.value = existingConfig.model || 'gpt-5';
                aiImageQuality.value = existingConfig.quality || 'auto';
                aiImageFormat.value = existingConfig.format || 'png';
                aiImageCompression.value = existingConfig.output_compression || 85;
            } else {
                aiImagePrompt.value = '';
                aiImageModel.value = 'gpt-5';
                aiImageQuality.value = 'auto';
                aiImageFormat.value = 'png';
                aiImageCompression.value = 85;
            }

            // Show/hide compression based on format
            updateCompressionVisibility();

            aiImageModal.classList.add('open');
        }

        function closeAIImageModal() {
            const aiImageModal = document.getElementById('aiImageModal');
            if (aiImageModal) {
                aiImageModal.classList.remove('open');
            }
            currentAIImageElement = null;
        }

        function updateCompressionVisibility() {
            const aiImageFormat = document.getElementById('aiImageFormat');
            const compressionGroup = document.getElementById('compressionGroup');

            if (aiImageFormat && compressionGroup) {
                const format = aiImageFormat.value;
                // Show compression for JPEG and WebP
                if (format === 'jpeg' || format === 'webp') {
                    compressionGroup.style.display = 'block';
                } else {
                    compressionGroup.style.display = 'none';
                }
            }
        }

        // Preview Mode State
        let isPreviewMode = false;
        let previewStartTime = null;
        let previewAnimationFrame = null;
        let currentPlayingMedia = null;
        let previewElements = []; // Prepared elements for preview
        
        // Scroll detection for preview
        let lastScrollLeft = 0;
        let scrollCheckActive = false;

        // Playback control state
        let playbackSpeed = 1.0;
        let timelineStartTime = null;
        let isPreviewPaused = false;
        let pausedElapsedTime = 0;
        let currentElementIndex = 0;

        // ===== POOL MANAGEMENT FUNCTIONS =====

        // Initialize IndexedDB
        function initDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open('CreatorPoolsDB', 2); // Bumped version to 2

                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    dbInstance = request.result;
                    resolve(dbInstance);
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    // Create object stores for video and image pools
                    if (!db.objectStoreNames.contains('videoPools')) {
                        db.createObjectStore('videoPools', { keyPath: 'id', autoIncrement: true });
                    }
                    if (!db.objectStoreNames.contains('imagePools')) {
                        db.createObjectStore('imagePools', { keyPath: 'id', autoIncrement: true });
                    }

                    // Create object stores for individual media files (NEW)
                    if (!db.objectStoreNames.contains('mediaFiles')) {
                        db.createObjectStore('mediaFiles', { keyPath: 'key' });
                    }
                };
            });
        }

        // Store media file in IndexedDB
        async function storeMediaFile(file, type) {
            try {
                if (!dbInstance) {
                    await initDB();
                }

                // Generate unique key
                const key = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                // Convert File to base64 for storage
                const dataURL = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                const mediaData = {
                    key: key,
                    type: type,
                    filename: file.name,
                    size: file.size,
                    mimeType: file.type,
                    lastModified: file.lastModified,
                    dataURL: dataURL,
                    timestamp: Date.now()
                };

                return new Promise((resolve, reject) => {
                    const transaction = dbInstance.transaction(['mediaFiles'], 'readwrite');
                    const store = transaction.objectStore('mediaFiles');
                    const request = store.put(mediaData);

                    request.onsuccess = () => {
                        console.log(`Stored media file in IndexedDB: ${key} (${file.name})`);
                        resolve(key);
                    };
                    request.onerror = () => reject(request.error);
                });
            } catch (err) {
                console.error('Failed to store media file:', err);
                throw err;
            }
        }

        // Retrieve media file from IndexedDB
        async function getMediaFile(key) {
            try {
                if (!dbInstance) {
                    await initDB();
                }

                return new Promise((resolve, reject) => {
                    const transaction = dbInstance.transaction(['mediaFiles'], 'readonly');
                    const store = transaction.objectStore('mediaFiles');
                    const request = store.get(key);

                    request.onsuccess = () => {
                        if (request.result) {
                            console.log(`Retrieved media file from IndexedDB: ${key}`);
                            resolve(request.result);
                        } else {
                            console.warn(`Media file not found in IndexedDB: ${key}`);
                            resolve(null);
                        }
                    };
                    request.onerror = () => reject(request.error);
                });
            } catch (err) {
                console.error('Failed to retrieve media file:', err);
                return null;
            }
        }

        // Delete media file from IndexedDB
        async function deleteMediaFile(key) {
            try {
                if (!dbInstance) {
                    await initDB();
                }

                return new Promise((resolve, reject) => {
                    const transaction = dbInstance.transaction(['mediaFiles'], 'readwrite');
                    const store = transaction.objectStore('mediaFiles');
                    const request = store.delete(key);

                    request.onsuccess = () => {
                        console.log(`Deleted media file from IndexedDB: ${key}`);
                        resolve();
                    };
                    request.onerror = () => reject(request.error);
                });
            } catch (err) {
                console.error('Failed to delete media file:', err);
            }
        }

        // Load pools from IndexedDB
        async function loadPools() {
            try {
                if (!dbInstance) {
                    await initDB();
                }

                const videoTransaction = dbInstance.transaction(['videoPools'], 'readonly');
                const videoStore = videoTransaction.objectStore('videoPools');
                const videoRequest = videoStore.getAll();

                const imageTransaction = dbInstance.transaction(['imagePools'], 'readonly');
                const imageStore = imageTransaction.objectStore('imagePools');
                const imageRequest = imageStore.getAll();

                videoRequest.onsuccess = () => {
                    videoPools = videoRequest.result || [];
                };

                imageRequest.onsuccess = () => {
                    imagePools = imageRequest.result || [];
                };
            } catch (err) {
                console.error('Error loading pools:', err);
            }
        }

        // Save pool to IndexedDB
        function savePool(poolData, type) {
            return new Promise((resolve, reject) => {
                const storeName = type === 'video' ? 'videoPools' : 'imagePools';
                const transaction = dbInstance.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.add(poolData);

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }

        // Get pool from IndexedDB by ID
        function getPoolById(poolId, type) {
            return new Promise((resolve, reject) => {
                if (!dbInstance) {
                    reject(new Error('Database not initialized'));
                    return;
                }
                
                const storeName = type === 'video' ? 'videoPools' : 'imagePools';
                const transaction = dbInstance.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.get(poolId);

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }

        // Create custom dropdown
        function createCustomDropdown(type) {
            const pools = type === 'video' ? videoPools : imagePools;

            const dropdown = document.createElement('div');
            dropdown.className = 'custom-dropdown';
            dropdown.dataset.type = type;

            const trigger = document.createElement('div');
            trigger.className = 'custom-dropdown-trigger';
            trigger.innerHTML = `
                <span>Select ${type} pool...</span>
                <span class="custom-dropdown-arrow">▼</span>
            `;

            const list = document.createElement('div');
            list.className = 'custom-dropdown-list';

            // Add existing pools
            if (pools.length > 0) {
                pools.forEach((pool, index) => {
                    const item = document.createElement('div');
                    item.className = 'custom-dropdown-item';
                    item.dataset.poolIndex = index;
                    item.innerHTML = `
                        <span>${pool.name}</span>
                        <span class="custom-dropdown-item-count">(${pool.files.length} ${type}${pool.files.length !== 1 ? 's' : ''})</span>
                    `;
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        selectPool(dropdown, pool, index);
                    });
                    list.appendChild(item);
                });
            }

            // Add "Create Pool" option
            const createItem = document.createElement('div');
            createItem.className = 'custom-dropdown-item create-pool';
            createItem.innerHTML = '<span>+ Create Pool</span>';
            createItem.addEventListener('click', (e) => {
                e.stopPropagation();
                openPoolModal(type, dropdown);
            });
            list.appendChild(createItem);

            dropdown.appendChild(trigger);
            dropdown.appendChild(list);

            // Toggle dropdown
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = list.classList.contains('open');

                // Close all dropdowns
                document.querySelectorAll('.custom-dropdown-list').forEach(l => l.classList.remove('open'));
                document.querySelectorAll('.custom-dropdown-trigger').forEach(t => t.classList.remove('open'));
                document.querySelectorAll('.edit-binding-menu').forEach(m => m.classList.remove('open'));

                if (!isOpen) {
                    list.classList.add('open');
                    trigger.classList.add('open');
                }
            });

            return dropdown;
        }

        // Create a simple custom dropdown for form selects (Model, Duration, etc.)
        function createSimpleCustomDropdown(options, defaultValue = null) {
            const dropdown = document.createElement('div');
            dropdown.className = 'custom-dropdown';

            const trigger = document.createElement('div');
            trigger.className = 'custom-dropdown-trigger';

            // Find default option
            const defaultOption = options.find(opt => opt.value === defaultValue) || options[0];
            trigger.innerHTML = `
                <span>${defaultOption.label}</span>
                <span class="custom-dropdown-arrow">▼</span>
            `;

            const list = document.createElement('div');
            list.className = 'custom-dropdown-list';

            // Add options
            options.forEach(option => {
                const item = document.createElement('div');
                item.className = 'custom-dropdown-item';
                item.dataset.value = option.value;
                item.innerHTML = `<span>${option.label}</span>`;

                item.addEventListener('click', (e) => {
                    e.stopPropagation();

                    // Update trigger text
                    trigger.innerHTML = `
                        <span>${option.label}</span>
                        <span class="custom-dropdown-arrow">▼</span>
                    `;

                    // Store selected value
                    dropdown.dataset.selectedValue = option.value;

                    // Close dropdown
                    list.classList.remove('open');
                    trigger.classList.remove('open');
                });

                list.appendChild(item);
            });

            dropdown.appendChild(trigger);
            dropdown.appendChild(list);

            // Toggle dropdown
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = list.classList.contains('open');

                // Close all dropdowns
                document.querySelectorAll('.custom-dropdown-list').forEach(l => l.classList.remove('open'));
                document.querySelectorAll('.custom-dropdown-trigger').forEach(t => t.classList.remove('open'));
                document.querySelectorAll('.edit-binding-menu').forEach(m => m.classList.remove('open'));

                if (!isOpen) {
                    list.classList.add('open');
                    trigger.classList.add('open');
                }
            });

            // Store initial value
            dropdown.dataset.selectedValue = defaultOption.value;

            return dropdown;
        }

        // Create pool dropdown
        function createPoolDropdown(pools, type) {
            const dropdown = document.createElement('div');
            dropdown.className = 'custom-dropdown';
            dropdown.dataset.type = type; // Store the type (video/image) on the dropdown

            const trigger = document.createElement('div');
            trigger.className = 'custom-dropdown-trigger';
            trigger.innerHTML = `
                <span>Select ${type} pool...</span>
                <span class="custom-dropdown-arrow">▼</span>
            `;

            const list = document.createElement('div');
            list.className = 'custom-dropdown-list';

            // Add pool options
            pools.forEach((pool, index) => {
                const item = document.createElement('div');
                item.className = 'custom-dropdown-item';
                item.dataset.poolIndex = index;
                item.innerHTML = `
                    <span>${pool.name}</span>
                    <span class="custom-dropdown-item-count">(${pool.files.length} ${type}${pool.files.length !== 1 ? 's' : ''})</span>
                `;

                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectPool(dropdown, pool, index);
                    list.classList.remove('open');
                    trigger.classList.remove('open');
                });

                list.appendChild(item);
            });

            // Add "Create Pool" option
            const createItem = document.createElement('div');
            createItem.className = 'custom-dropdown-item create-pool';
            createItem.innerHTML = '<span>+ Create New Pool</span>';
            createItem.addEventListener('click', (e) => {
                e.stopPropagation();
                openPoolModal(type, dropdown);
                list.classList.remove('open');
                trigger.classList.remove('open');
            });
            list.appendChild(createItem);

            dropdown.appendChild(trigger);
            dropdown.appendChild(list);

            // Toggle dropdown
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = list.classList.contains('open');

                // Close all dropdowns
                document.querySelectorAll('.custom-dropdown-list').forEach(l => l.classList.remove('open'));
                document.querySelectorAll('.custom-dropdown-trigger').forEach(t => t.classList.remove('open'));

                if (!isOpen) {
                    list.classList.add('open');
                    trigger.classList.add('open');
                }
            });

            return dropdown;
        }

        // Select a pool from dropdown
        function selectPool(dropdown, pool, index) {
            const trigger = dropdown.querySelector('.custom-dropdown-trigger');
            const list = dropdown.querySelector('.custom-dropdown-list');

            trigger.innerHTML = `
                <span>${pool.name}</span>
                <span class="custom-dropdown-arrow">▼</span>
            `;

            // Store selected pool data on the element
            const elementDiv = dropdown.closest('.timeline-element');
            dropdown.dataset.selectedPool = index;

            // Store pool data as JSON on the element for later retrieval
            elementDiv.dataset.poolData = JSON.stringify(pool);
            
            // Store pool type and name for later reference
            elementDiv.dataset.poolType = dropdown.dataset.type; // 'video' or 'image'
            elementDiv.dataset.poolName = pool.name;
            
            // Store the IndexedDB ID for serialization (critical for JSON export)
            if (pool.id) {
                elementDiv.dataset.poolId = pool.id;
                console.log(`[POOL SELECT] Selected pool: ${pool.name} (ID: ${pool.id}, Type: ${dropdown.dataset.type})`);
            } else {
                console.error(`[POOL SELECT ERROR] Pool has no ID! Name: ${pool.name}, Type: ${dropdown.dataset.type}`);
                console.error(`[POOL SELECT ERROR] Pool object:`, pool);
            }

            // Close dropdown
            list.classList.remove('open');
            trigger.classList.remove('open');
            
            // CRITICAL FIX: If this is the initial element, convert it to a real element
            let elementId = elementDiv.dataset.elementId;
            if (elementId === 'initial') {
                const newElementId = `element-${nextElementId++}`;
                console.log(`[POOL FIX] Converting initial element to real element: ${newElementId}`);
                elementDiv.dataset.elementId = newElementId;
                elementDiv.classList.remove('add-element-btn');
                elementId = newElementId; // Update local variable

                // Create new "Add Element" button with proper structure
                const elementsRow = document.getElementById('elementsRow');
                const newAddBtn = document.createElement('div');
                newAddBtn.className = 'timeline-element';
                newAddBtn.dataset.elementId = 'initial';
                newAddBtn.dataset.duration = '5';
                newAddBtn.dataset.type = 'none';
                newAddBtn.innerHTML = `
                    <div class="element-content">
                        <div class="add-element-btn">
                            <span class="icon">+</span>
                            <span class="label">Add Element</span>
                        </div>
                    </div>
                `;
                const addBtnInner = newAddBtn.querySelector('.add-element-btn');
                addBtnInner.addEventListener('click', (e) => showDropdown(newAddBtn, e));
                elementsRow.appendChild(newAddBtn);

                console.log(`[POOL FIX] Created new Add Element button`);
            }
            
            // Automatically finalize the element as 'pool' type
            finalizeElement(elementDiv, 'pool', elementId);
        }

        // Update pool thumbnail overlays only (for resize)
        function updatePoolThumbnailOverlays(elementDiv, pool, targetDuration) {
            const thumbnails = elementDiv.querySelectorAll('.pool-thumbnail');

            pool.files.forEach((file, idx) => {
                if (idx >= thumbnails.length) return;

                const thumbnail = thumbnails[idx];
                const duration = file.duration || null;

                // Remove existing overlays
                thumbnail.classList.remove('excluded');
                const existingOverlay = thumbnail.querySelector('.pool-thumbnail-trim-overlay');
                if (existingOverlay) existingOverlay.remove();

                if (duration) {
                    if (duration < targetDuration) {
                        // Too short - add excluded class
                        thumbnail.classList.add('excluded');
                    } else if (duration > targetDuration) {
                        // Too long - add trim overlay
                        const trimPercent = ((duration - targetDuration) / duration) * 100;
                        const overlay = document.createElement('div');
                        overlay.className = 'pool-thumbnail-trim-overlay';
                        overlay.style.width = `${trimPercent}%`;
                        thumbnail.appendChild(overlay);
                    }
                }
            });
        }

        // Display pool thumbnails with status in element preview
        function displayPoolThumbnails(elementDiv, pool) {
            const elementPreview = elementDiv.querySelector('.element-preview');
            if (!elementPreview) return;

            // Get current element duration
            const targetDuration = parseInt(elementDiv.dataset.duration) || 5;

            // Remove existing thumbnail container
            const existing = elementPreview.querySelector('.pool-thumbnails-container');
            if (existing) existing.remove();

            // Create thumbnail container
            const container = document.createElement('div');
            container.className = 'pool-thumbnails-container';

            const grid = document.createElement('div');
            grid.className = 'pool-thumbnails-grid';

            // Create thumbnails for each file
            pool.files.forEach((file, idx) => {
                const duration = file.duration || null;
                const thumbnail = document.createElement('div');
                thumbnail.className = 'pool-thumbnail';

                // Determine status
                let status = 'normal';
                let trimPercent = 0;
                let tooltipText = '';

                if (duration) {
                    if (duration < targetDuration) {
                        // Check if loop is enabled
                        if (file.loop) {
                            status = 'looped';
                            tooltipText = `Video will loop: ${duration}s (looped to ${targetDuration}s)`;
                        } else {
                            status = 'excluded';
                            tooltipText = `Video excluded: too short (${duration}s < ${targetDuration}s required)`;
                        }
                    } else if (duration > targetDuration) {
                        status = 'trimmed';
                        trimPercent = ((duration - targetDuration) / duration) * 100;
                        tooltipText = `Video will be trimmed: ${duration}s → ${targetDuration}s`;
                    } else {
                        tooltipText = `Video duration: ${duration}s ✓`;
                    }
                } else {
                    tooltipText = `Duration unknown`;
                }

                // Add status class
                if (status === 'excluded') {
                    thumbnail.classList.add('excluded');
                } else if (status === 'looped') {
                    thumbnail.classList.add('looped');
                }

                // Create thumbnail image/video
                if (file.type.startsWith('video/')) {
                    const video = document.createElement('video');
                    video.src = file.data;
                    video.muted = true;
                    thumbnail.appendChild(video);
                } else if (file.type.startsWith('image/')) {
                    const img = document.createElement('img');
                    img.src = file.data;
                    thumbnail.appendChild(img);
                }

                // Add trim overlay if needed
                if (status === 'trimmed') {
                    const overlay = document.createElement('div');
                    overlay.className = 'pool-thumbnail-trim-overlay';
                    overlay.style.width = `${trimPercent}%`;
                    thumbnail.appendChild(overlay);
                }

                // Add duration badge
                if (duration) {
                    const badge = document.createElement('div');
                    badge.className = 'pool-thumbnail-duration';
                    badge.textContent = `${duration}s`;
                    thumbnail.appendChild(badge);
                }

                // Add tooltip
                const tooltip = document.createElement('div');
                tooltip.className = 'pool-thumbnail-tooltip';
                tooltip.textContent = tooltipText;
                thumbnail.appendChild(tooltip);

                // Add click handler to open appropriate modal
                thumbnail.addEventListener('click', () => {
                    if (status === 'excluded' || status === 'looped') {
                        openExcludedVideoModal(file, elementDiv, pool);
                    } else if (status === 'trimmed') {
                        openTrimEditorModal(file, targetDuration);
                    }
                });

                grid.appendChild(thumbnail);
            });

            container.appendChild(grid);

            // Add pool name label after the grid
            const label = document.createElement('div');
            label.className = 'pool-thumbnails-label';
            label.textContent = pool.name;
            container.appendChild(label);

            // Append to element preview
            elementPreview.appendChild(container);
        }

        // Open pool creation modal
        function openPoolModal(type, dropdown) {
            currentPoolType = type;
            activeDropdown = dropdown;
            currentPoolFiles = [];

            const modal = document.getElementById('poolModal');
            const poolNameInput = document.getElementById('poolName');
            const fileInput = document.getElementById('poolFileInput');
            const filePreviews = document.getElementById('filePreviews');

            // Update file input accept attribute
            fileInput.accept = type === 'video' ? 'video/*' : 'image/*';

            // Clear previous state
            poolNameInput.value = '';
            filePreviews.innerHTML = '';

            // Close any open dropdowns
            document.querySelectorAll('.custom-dropdown-list').forEach(l => l.classList.remove('open'));
            document.querySelectorAll('.custom-dropdown-trigger').forEach(t => t.classList.remove('open'));

            modal.classList.add('open');
        }

        // Close pool modal
        function closePoolModal() {
            const modal = document.getElementById('poolModal');
            modal.classList.remove('open');
            currentPoolFiles = [];
            currentPoolType = null;
            activeDropdown = null;
        }

        // Add files to preview
        function addFilesToPreview(files) {
            const filePreviews = document.getElementById('filePreviews');

            Array.from(files).forEach(file => {
                // Check if file type matches current pool type
                const isVideo = file.type.startsWith('video/');
                const isImage = file.type.startsWith('image/');

                if ((currentPoolType === 'video' && !isVideo) || (currentPoolType === 'image' && !isImage)) {
                    return; // Skip incompatible files
                }

                currentPoolFiles.push(file);

                const preview = document.createElement('div');
                preview.className = 'file-preview';
                preview.dataset.fileIndex = currentPoolFiles.length - 1;

                const reader = new FileReader();
                reader.onload = (e) => {
                    if (isVideo) {
                        const video = document.createElement('video');
                        video.src = e.target.result;
                        // Extract video duration
                        video.addEventListener('loadedmetadata', () => {
                            file.videoDuration = Math.round(video.duration * 10) / 10; // Round to 1 decimal
                            console.log(`Video duration: ${file.name} = ${file.videoDuration}s`);
                        });
                        preview.appendChild(video);
                    } else if (isImage) {
                        const img = document.createElement('img');
                        img.src = e.target.result;
                        preview.appendChild(img);
                    }
                };
                reader.readAsDataURL(file);

                const removeBtn = document.createElement('div');
                removeBtn.className = 'file-preview-remove';
                removeBtn.innerHTML = '×';
                removeBtn.addEventListener('click', () => {
                    const fileIndex = parseInt(preview.dataset.fileIndex);
                    currentPoolFiles.splice(fileIndex, 1);
                    preview.remove();
                    // Update remaining indices
                    filePreviews.querySelectorAll('.file-preview').forEach((p, i) => {
                        p.dataset.fileIndex = i;
                    });
                });
                preview.appendChild(removeBtn);

                filePreviews.appendChild(preview);
            });
        }

        // Create pool and save
        async function createPool(e) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            console.log('createPool called');
            const poolName = document.getElementById('poolName').value.trim();
            console.log('Pool name:', poolName);
            console.log('Current pool files:', currentPoolFiles);

            if (!poolName) {
                alert('Please enter a pool name');
                return;
            }

            if (currentPoolFiles.length === 0) {
                alert('Please add at least one file');
                return;
            }

            try {
                // Convert files to data URLs for storage and wait for video durations
                const filePromises = currentPoolFiles.map(file => {
                    return new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            const fileObj = {
                                name: file.name,
                                type: file.type,
                                data: e.target.result,
                                duration: null
                            };

                            // If it's a video, wait for duration to load
                            if (file.type.startsWith('video/')) {
                                const video = document.createElement('video');
                                video.src = e.target.result;
                                video.addEventListener('loadedmetadata', () => {
                                    fileObj.duration = Math.round(video.duration * 10) / 10;
                                    console.log(`Duration captured for ${file.name}: ${fileObj.duration}s`);
                                    resolve(fileObj);
                                });
                                video.addEventListener('error', () => {
                                    console.warn(`Could not load duration for ${file.name}`);
                                    resolve(fileObj); // Resolve anyway with null duration
                                });
                            } else {
                                // For images, resolve immediately
                                resolve(fileObj);
                            }
                        };
                        reader.readAsDataURL(file);
                    });
                });

                const fileData = await Promise.all(filePromises);
                console.log('Files converted, count:', fileData.length);
                console.log('Durations:', fileData.map(f => f.duration));

                const newPool = {
                    name: poolName,
                    type: currentPoolType, // 'video' or 'image' - CRITICAL for serialization
                    files: fileData,
                    createdAt: new Date().toISOString()
                };

                // Save to IndexedDB
                console.log('Saving to IndexedDB...');
                const poolId = await savePool(newPool, currentPoolType);
                newPool.id = poolId; // Add the auto-generated ID
                
                console.log(`[POOL CREATE] Created pool: ${poolName} (ID: ${poolId}, Type: ${currentPoolType}, Files: ${fileData.length})`);

                // Add to appropriate pool array
                if (currentPoolType === 'video') {
                    videoPools.push(newPool);
                } else {
                    imagePools.push(newPool);
                }

                console.log('Pool saved successfully with ID:', poolId);

                // Update the dropdown that triggered this
                if (activeDropdown) {
                    const newIndex = (currentPoolType === 'video' ? videoPools : imagePools).length - 1;
                    refreshDropdown(activeDropdown, currentPoolType);
                    selectPool(activeDropdown, newPool, newIndex);
                }

                // Close modal
                console.log('Closing modal...');
                closePoolModal();
            } catch (err) {
                console.error('Error creating pool:', err);
                alert('Error creating pool: ' + err.message);
            }
        }

        // ========== VARIABLE POOL MANAGEMENT ==========

        // Parse variable values from different formats
        function parseVariableValues(inputText) {
            const trimmed = inputText.trim();

            // Try JSON first
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    return Array.isArray(parsed) ? parsed : [parsed];
                } catch (e) {
                    console.warn('Failed to parse as JSON:', e);
                }
            }

            // Try comma-separated
            if (trimmed.includes(',') && !trimmed.includes('\n')) {
                return trimmed.split(',').map(v => v.trim()).filter(v => v);
            }

            // Default: line-separated
            return trimmed.split('\n').map(v => v.trim()).filter(v => v);
        }

        // Create new variable pool
        function createVariablePool() {
            const name = document.getElementById('varPoolName').value.trim();
            const cycleMode = document.getElementById('varPoolCycleMode').value;
            const valuesInput = document.getElementById('varPoolValues').value.trim();

            if (!name) {
                alert('Please enter a pool name');
                return;
            }

            if (!valuesInput) {
                alert('Please enter at least one value');
                return;
            }

            try {
                const values = parseVariableValues(valuesInput);

                if (values.length === 0) {
                    alert('No valid values found');
                    return;
                }

                // Check if values are objects (nested) or simple strings
                const isNested = typeof values[0] === 'object';

                const newPool = {
                    id: `var_${nextVariablePoolId++}`,
                    name: name,
                    cycleMode: cycleMode,
                    isNested: isNested,
                    values: values
                };

                variablePools.push(newPool);

                // Save to localStorage
                saveVariablePools();

                console.log('Variable pool created:', newPool);

                // Insert variable reference if a field is active
                if (activeVariableField) {
                    if (activeVariableField === 'EDIT_MODE') {
                        // For edit mode, we'll show an alert with the variable syntax
                        const variableText = isNested ? `{${name}.property}` : `{${name}}`;
                        alert(`Variable pool created! Click "Create Edit" and use: ${variableText}`);
                    } else {
                        insertVariableReference(activeVariableField, name, isNested);
                    }
                }

                // Close modal
                closeVariablePoolModal();

                alert(`Variable pool "${name}" created with ${values.length} value(s)`);
            } catch (err) {
                console.error('Error creating variable pool:', err);
                alert('Error creating variable pool: ' + err.message);
            }
        }

        // Save variable pools to localStorage
        function saveVariablePools() {
            try {
                localStorage.setItem('beampage_variable_pools', JSON.stringify(variablePools));
            } catch (err) {
                console.error('Error saving variable pools:', err);
            }
        }

        // Load variable pools from localStorage
        function loadVariablePools() {
            try {
                const stored = localStorage.getItem('beampage_variable_pools');
                if (stored) {
                    variablePools = JSON.parse(stored);
                    // Find highest ID to continue numbering
                    variablePools.forEach(pool => {
                        const idNum = parseInt(pool.id.replace('var_', ''));
                        if (idNum >= nextVariablePoolId) {
                            nextVariablePoolId = idNum + 1;
                        }
                    });
                }
            } catch (err) {
                console.error('Error loading variable pools:', err);
            }
        }

        // Insert variable reference into active field
        function insertVariableReference(field, poolName, isNested) {
            const cursorPos = field.selectionStart;
            const textBefore = field.value.substring(0, cursorPos);
            const textAfter = field.value.substring(cursorPos);

            // For nested pools, show user they can use dot notation
            const reference = isNested ? `{${poolName}.property}` : `{${poolName}}`;

            field.value = textBefore + reference + textAfter;

            // Set cursor after inserted text
            const newPos = cursorPos + reference.length;
            field.setSelectionRange(newPos, newPos);
            field.focus();
        }

        // Variable cycling state (for within-video mode)
        let variableUsageIndex = {};

        // Resolve variables in text
        function resolveVariables(text, mode = 'preview') {
            if (!text) return text;

            let resolvedText = text;

            // Pattern 1: {variableName[index]} or {variableName[key]}
            const indexedPattern = /\{(\w+)\[([^\]]+)\]\}/g;
            const indexedMatches = [...text.matchAll(indexedPattern)];

            indexedMatches.forEach(match => {
                const varName = match[1];
                const indexOrKey = match[2];
                const pool = variablePools.find(p => p.name === varName);

                if (pool && pool.values && pool.values.length > 0) {
                    let currentEntry;

                    // Get the current entry based on cycle mode
                    if (pool.cycleMode === 'within-video') {
                        if (!variableUsageIndex[varName]) {
                            variableUsageIndex[varName] = 0;
                        }
                        const entryIndex = variableUsageIndex[varName] % pool.values.length;
                        currentEntry = pool.values[entryIndex];

                        // Increment for next usage (only in actual generation, not preview)
                        if (mode === 'generate') {
                            variableUsageIndex[varName]++;
                        }
                    } else {
                        // Between videos: use random entry
                        const randomIndex = Math.floor(Math.random() * pool.values.length);
                        currentEntry = pool.values[randomIndex];
                    }

                    let value;

                    // Check if currentEntry is an array or object
                    if (Array.isArray(currentEntry)) {
                        // Array format: use numeric index
                        const index = parseInt(indexOrKey, 10);
                        if (!isNaN(index) && index >= 0 && index < currentEntry.length) {
                            value = currentEntry[index];
                        }
                    } else if (typeof currentEntry === 'object' && currentEntry !== null) {
                        // Object format: use key
                        value = currentEntry[indexOrKey];
                    }

                    // If value is found, replace it
                    if (value !== undefined) {
                        if (typeof value === 'object') {
                            value = JSON.stringify(value);
                        }
                        resolvedText = resolvedText.replace(match[0], value);
                    }
                }
            });

            // Pattern 2: {variableName} - defaults to index 0
            const simplePattern = /\{(\w+)\}/g;
            const simpleMatches = [...resolvedText.matchAll(simplePattern)];

            simpleMatches.forEach(match => {
                const varName = match[1];
                const pool = variablePools.find(p => p.name === varName);

                if (pool && pool.values && pool.values.length > 0) {
                    let value;

                    if (pool.cycleMode === 'within-video') {
                        // Within video: cycle through values for each usage
                        if (!variableUsageIndex[varName]) {
                            variableUsageIndex[varName] = 0;
                        }
                        const index = variableUsageIndex[varName] % pool.values.length;
                        let currentEntry = pool.values[index];

                        // If entry is array or object, get first element/value
                        if (Array.isArray(currentEntry)) {
                            value = currentEntry[0]; // Default to index 0
                        } else if (typeof currentEntry === 'object' && currentEntry !== null) {
                            // For objects, get first value
                            value = Object.values(currentEntry)[0];
                        } else {
                            value = currentEntry;
                        }

                        // Increment for next usage (only in actual generation, not preview)
                        if (mode === 'generate') {
                            variableUsageIndex[varName]++;
                        }
                    } else {
                        // Between videos: use random value (same for all in this video)
                        const randomIndex = Math.floor(Math.random() * pool.values.length);
                        let currentEntry = pool.values[randomIndex];

                        // If entry is array or object, get first element/value
                        if (Array.isArray(currentEntry)) {
                            value = currentEntry[0]; // Default to index 0
                        } else if (typeof currentEntry === 'object' && currentEntry !== null) {
                            value = Object.values(currentEntry)[0];
                        } else {
                            value = currentEntry;
                        }
                    }

                    // Handle nested objects in value
                    if (typeof value === 'object') {
                        value = JSON.stringify(value);
                    }

                    if (value !== undefined) {
                        resolvedText = resolvedText.replace(match[0], value);
                    }
                }
            });

            return resolvedText;
        }

        // Reset variable cycling for a new video generation
        function resetVariableCycling() {
            variableUsageIndex = {};
        }

        // Show variable selection dropdown
        function showVariableDropdown(field, button) {
            activeVariableField = field;

            // Remove existing dropdown
            const existing = document.getElementById('variableDropdown');
            if (existing) existing.remove();

            const dropdown = document.createElement('div');
            dropdown.id = 'variableDropdown';
            dropdown.style.cssText = `
                position: absolute;
                background: #ffffff;
                border: none;
                border-radius: 12px;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.04);
                z-index: 99999;
                min-width: 220px;
                max-width: 320px;
                max-height: 400px;
                overflow: hidden;
                padding: 6px;
            `;

            // Position at bottom-right of button/cursor
            const rect = button.getBoundingClientRect();
            dropdown.style.top = (rect.bottom + window.scrollY + 8) + 'px';
            dropdown.style.left = (rect.right + 8) + 'px';

            // Create scrollable container for pool items
            const poolContainer = document.createElement('div');
            poolContainer.style.cssText = `
                max-height: 320px;
                overflow-y: auto;
                overflow-x: hidden;
            `;

            // Add existing pools
            if (variablePools.length > 0) {
                variablePools.forEach(pool => {
                    const item = document.createElement('div');
                    item.style.cssText = `
                        padding: 10px 14px;
                        cursor: pointer;
                        border-radius: 6px;
                        transition: background 0.15s ease;
                        margin-bottom: 2px;
                    `;
                    item.innerHTML = `
                        <div style="font-weight: 500; margin-bottom: 4px; color: #1d1d1f; font-size: 14px;">{${pool.name}}</div>
                        <div style="font-size: 12px; color: #86868b;">
                            ${pool.cycleMode === 'within-video' ? 'Within Video' : 'Between Videos'}
                            • ${pool.values.length} value${pool.values.length !== 1 ? 's' : ''}
                        </div>
                    `;
                    item.onmouseenter = () => item.style.background = '#f5f5f7';
                    item.onmouseleave = () => item.style.background = 'transparent';
                    item.onclick = () => {
                        insertVariableReference(field, pool.name, pool.isNested);
                        dropdown.remove();
                    };
                    poolContainer.appendChild(item);
                });
                dropdown.appendChild(poolContainer);

                // Add separator
                const separator = document.createElement('div');
                separator.style.cssText = 'height: 1px; background: #e8e8ed; margin: 6px 0;';
                dropdown.appendChild(separator);
            }

            // Add "Create New" option
            const createNew = document.createElement('div');
            createNew.style.cssText = `
                padding: 10px 14px;
                cursor: pointer;
                border-radius: 6px;
                transition: background 0.15s ease;
                display: flex;
                align-items: center;
                gap: 10px;
            `;
            createNew.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0071e3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="16"/>
                    <line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
                <span style="font-size: 14px; font-weight: 500; color: #0071e3;">
                    Create Variable Pool
                </span>
            `;
            createNew.onmouseenter = () => createNew.style.background = '#f5f5f7';
            createNew.onmouseleave = () => createNew.style.background = 'transparent';
            createNew.onclick = (e) => {
                e.stopPropagation();
                // Get dropdown position to show creator in same spot
                const dropdownRect = dropdown.getBoundingClientRect();
                dropdown.remove();
                showVariableCreatorAtPosition(dropdownRect.left, dropdownRect.top);
            };
            dropdown.appendChild(createNew);

            document.body.appendChild(dropdown);

            // Close on click outside
            setTimeout(() => {
                document.addEventListener('click', function closeDropdown(e) {
                    if (!dropdown.contains(e.target) && e.target !== button) {
                        dropdown.remove();
                        document.removeEventListener('click', closeDropdown);
                    }
                });
            }, 100);
        }

        // Show variable dropdown for edit text (adds new text element with variable)
        function showVariableDropdownForEdit(button) {
            // Remove existing dropdown
            const existing = document.getElementById('variableDropdown');
            if (existing) existing.remove();

            const dropdown = document.createElement('div');
            dropdown.id = 'variableDropdown';
            dropdown.style.cssText = `
                position: absolute;
                background: #ffffff;
                border: none;
                border-radius: 12px;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.04);
                z-index: 99999;
                min-width: 220px;
                max-width: 320px;
                max-height: 400px;
                overflow: hidden;
                padding: 6px;
            `;

            // Position at bottom-right of button/cursor
            const rect = button.getBoundingClientRect();
            dropdown.style.top = (rect.bottom + window.scrollY + 8) + 'px';
            dropdown.style.left = (rect.right + 8) + 'px';

            // Create scrollable container for pool items
            const poolContainer = document.createElement('div');
            poolContainer.style.cssText = `
                max-height: 320px;
                overflow-y: auto;
                overflow-x: hidden;
            `;

            // Add existing pools
            if (variablePools.length > 0) {
                variablePools.forEach(pool => {
                    const item = document.createElement('div');
                    item.style.cssText = `
                        padding: 10px 14px;
                        cursor: pointer;
                        border-radius: 6px;
                        transition: background 0.15s ease;
                        margin-bottom: 2px;
                    `;
                    item.innerHTML = `
                        <div style="font-weight: 500; margin-bottom: 4px; color: #1d1d1f; font-size: 14px;">{${pool.name}}</div>
                        <div style="font-size: 12px; color: #86868b;">
                            ${pool.cycleMode === 'within-video' ? 'Within Video' : 'Between Videos'}
                            • ${pool.values.length} value${pool.values.length !== 1 ? 's' : ''}
                        </div>
                    `;
                    item.onmouseenter = () => item.style.background = '#f5f5f7';
                    item.onmouseleave = () => item.style.background = 'transparent';
                    item.onclick = () => {
                        // Add new text element with variable reference
                        const variableText = pool.isNested ? `{${pool.name}.property}` : `{${pool.name}}`;

                        // Simulate clicking the Create Edit button to add new text
                        const createBtn = document.getElementById('createEditBtn');
                        if (createBtn) {
                            // Trigger the Create Edit button
                            createBtn.click();

                            // Wait a moment for the input to be created, then update its value
                            setTimeout(() => {
                                // Find the invisible input that was just created
                                const inputs = document.querySelectorAll('input[style*="opacity: 0"]');
                                const latestInput = inputs[inputs.length - 1];
                                if (latestInput) {
                                    latestInput.value = variableText;
                                    // Trigger input event to update the canvas
                                    const event = new Event('input', { bubbles: true });
                                    latestInput.dispatchEvent(event);
                                }
                            }, 100);
                        } else {
                            alert(`Add this to your text: ${variableText}`);
                        }

                        dropdown.remove();
                    };
                    poolContainer.appendChild(item);
                });
                dropdown.appendChild(poolContainer);

                // Add separator
                const separator = document.createElement('div');
                separator.style.cssText = 'height: 1px; background: #e8e8ed; margin: 6px 0;';
                dropdown.appendChild(separator);
            }

            // Add "Create New" option
            const createNew = document.createElement('div');
            createNew.style.cssText = `
                padding: 10px 14px;
                cursor: pointer;
                border-radius: 6px;
                transition: background 0.15s ease;
                display: flex;
                align-items: center;
                gap: 10px;
            `;
            createNew.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0071e3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="16"/>
                    <line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
                <span style="font-size: 14px; font-weight: 500; color: #0071e3;">
                    Create Variable Pool
                </span>
            `;
            createNew.onmouseenter = () => createNew.style.background = '#f5f5f7';
            createNew.onmouseleave = () => createNew.style.background = 'transparent';
            createNew.onclick = (e) => {
                e.stopPropagation();
                // Get dropdown position to show creator in same spot
                const dropdownRect = dropdown.getBoundingClientRect();
                dropdown.remove();
                // Set a flag so we know to insert into edit after creating
                activeVariableField = 'EDIT_MODE';
                showVariableCreatorAtPosition(dropdownRect.left, dropdownRect.top);
            };
            dropdown.appendChild(createNew);

            document.body.appendChild(dropdown);

            // Close on click outside
            setTimeout(() => {
                document.addEventListener('click', function closeDropdown(e) {
                    if (!dropdown.contains(e.target) && e.target !== button) {
                        dropdown.remove();
                        document.removeEventListener('click', closeDropdown);
                    }
                });
            }, 100);
        }

        // Show variable creator at specific position (replaces dropdown)
        function showVariableCreatorAtPosition(left, top) {
            // Create inline creator form
            const creator = document.createElement('div');
            creator.id = 'variableCreatorInline';
            creator.style.cssText = `
                position: fixed;
                left: ${left}px;
                top: ${top}px;
                background: #ffffff;
                border-radius: 12px;
                padding: 16px;
                width: 320px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.04);
                z-index: 99999;
                animation: fadeIn 0.15s ease forwards;
            `;

            creator.innerHTML = `
                <div style="margin-bottom: 12px;">
                    <h3 style="font-size: 16px; font-weight: 600; color: #1d1d1f; margin: 0 0 12px 0;">Create Variable Pool</h3>
                </div>
                <div style="margin-bottom: 12px;">
                    <label style="font-size: 13px; font-weight: 500; color: #1d1d1f; display: block; margin-bottom: 6px;">Pool Name *</label>
                    <input type="text" id="inlineVarPoolName" placeholder="e.g., country" style="width: 100%; padding: 10px; border: 1px solid #d2d2d7; border-radius: 8px; font-size: 13px;">
                </div>
                <div style="margin-bottom: 12px;">
                    <label style="font-size: 13px; font-weight: 500; color: #1d1d1f; display: block; margin-bottom: 6px;">Cycle Mode *</label>
                    <select id="inlineVarPoolCycleMode" style="width: 100%; padding: 10px; border: 1px solid #d2d2d7; border-radius: 8px; font-size: 13px;">
                        <option value="within-video">Within Video</option>
                        <option value="between-videos">Between Videos</option>
                    </select>
                </div>
                <div style="margin-bottom: 12px;">
                    <label style="font-size: 13px; font-weight: 500; color: #1d1d1f; display: block; margin-bottom: 6px;">Values *</label>
                    <textarea id="inlineVarPoolValues" placeholder="One per line&#10;&#10;Thailand&#10;Italy&#10;Mexico" rows="4" style="width: 100%; padding: 10px; border: 1px solid #d2d2d7; border-radius: 8px; font-family: 'Courier New', monospace; font-size: 12px; resize: vertical;"></textarea>
                </div>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button type="button" id="inlineVarPoolCancel" style="padding: 8px 16px; background: #f5f5f7; color: #1d1d1f; border: none; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer;">Cancel</button>
                    <button type="button" id="inlineVarPoolCreate" style="padding: 8px 16px; background: #0071e3; color: #ffffff; border: none; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer;">Create</button>
                </div>
            `;

            document.body.appendChild(creator);

            // Position within bounds
            const creatorRect = creator.getBoundingClientRect();
            if (creatorRect.right > window.innerWidth) {
                creator.style.left = (window.innerWidth - creatorRect.width - 20) + 'px';
            }
            if (creatorRect.bottom > window.innerHeight) {
                creator.style.top = (window.innerHeight - creatorRect.height - 20) + 'px';
            }

            // Event handlers
            document.getElementById('inlineVarPoolCancel').onclick = () => {
                creator.remove();
            };

            document.getElementById('inlineVarPoolCreate').onclick = () => {
                const name = document.getElementById('inlineVarPoolName').value.trim();
                const cycleMode = document.getElementById('inlineVarPoolCycleMode').value;
                const valuesText = document.getElementById('inlineVarPoolValues').value.trim();

                if (!name || !valuesText) {
                    alert('Please fill in all required fields');
                    return;
                }

                // Parse values
                let values = [];
                let isNested = false;

                try {
                    // Try JSON first
                    const parsed = JSON.parse(valuesText);
                    if (Array.isArray(parsed)) {
                        values = parsed;
                        isNested = parsed.length > 0 && typeof parsed[0] === 'object';
                    }
                } catch (e) {
                    // Not JSON, try line-by-line or comma-separated
                    if (valuesText.includes('\n')) {
                        values = valuesText.split('\n').map(v => v.trim()).filter(v => v);
                    } else if (valuesText.includes(',')) {
                        values = valuesText.split(',').map(v => v.trim()).filter(v => v);
                    } else {
                        values = [valuesText];
                    }
                }

                if (values.length === 0) {
                    alert('Please provide at least one value');
                    return;
                }

                // Create pool
                const pool = {
                    id: nextVariablePoolId++,
                    name: name,
                    cycleMode: cycleMode,
                    values: values,
                    isNested: isNested
                };

                variablePools.push(pool);

                // If there's an active field, insert the variable
                if (activeVariableField && activeVariableField !== 'EDIT_MODE') {
                    insertVariableReference(activeVariableField, pool.name, pool.isNested);
                    activeVariableField = null;
                }

                creator.remove();
                alert(`Variable pool "${name}" created with ${values.length} value(s)`);
            };

            // Close on click outside
            const closeOnClickOutside = (e) => {
                if (!creator.contains(e.target)) {
                    creator.remove();
                    document.removeEventListener('click', closeOnClickOutside);
                }
            };

            setTimeout(() => {
                document.addEventListener('click', closeOnClickOutside);
            }, 100);
        }

        // Open variable pool creation modal
        function openVariablePoolModal() {
            const modal = document.getElementById('variablePoolModal');
            modal.style.display = 'flex';

            // Reset form
            document.getElementById('varPoolName').value = '';
            document.getElementById('varPoolCycleMode').value = 'within-video';
            document.getElementById('varPoolValues').value = '';
        }

        // Open variable pool modal positioned at cursor (bottom-right)
        function openVariablePoolModalAtCursor(event) {
            const modal = document.getElementById('variablePoolModal');
            const modalContent = modal.querySelector('.modal-content');

            // Reset form
            document.getElementById('varPoolName').value = '';
            document.getElementById('varPoolCycleMode').value = 'within-video';
            document.getElementById('varPoolValues').value = '';

            // Remove overlay styling and use absolute positioning
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: transparent;
                z-index: 10000;
                display: flex;
                align-items: flex-start;
                justify-content: flex-start;
                backdrop-filter: none;
            `;

            // Position content at cursor (bottom-right) with bounds checking
            const x = event.clientX || event.pageX;
            const y = event.clientY || event.pageY;
            const modalWidth = 380;
            const modalHeight = 400; // Approximate height

            // Calculate position, ensuring it stays within viewport
            let left = x + 10;
            let top = y + 10;

            // Check right boundary
            if (left + modalWidth > window.innerWidth) {
                left = window.innerWidth - modalWidth - 20;
            }

            // Check bottom boundary
            if (top + modalHeight > window.innerHeight) {
                top = window.innerHeight - modalHeight - 20;
            }

            // Ensure minimum position
            left = Math.max(20, left);
            top = Math.max(20, top);

            modalContent.style.cssText = `
                position: absolute;
                left: ${left}px;
                top: ${top}px;
                background: #ffffff;
                border-radius: 12px;
                padding: 20px;
                width: 380px;
                max-width: 90vw;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.04);
                animation: fadeIn 0.15s ease forwards;
            `;

            // Close on click outside
            const closeOnClickOutside = (e) => {
                if (!modalContent.contains(e.target)) {
                    closeVariablePoolModal();
                    modal.removeEventListener('click', closeOnClickOutside);
                }
            };

            // Add listener after a brief delay to prevent immediate closure
            setTimeout(() => {
                modal.addEventListener('click', closeOnClickOutside);
            }, 100);
        }

        // Close variable pool modal
        function closeVariablePoolModal() {
            const modal = document.getElementById('variablePoolModal');
            modal.style.display = 'none';
            activeVariableField = null;
        }


        // Refresh dropdown with updated pools
        function refreshDropdown(dropdown, type) {
            const pools = type === 'video' ? videoPools : imagePools;
            const list = dropdown.querySelector('.custom-dropdown-list');
            list.innerHTML = '';

            // Add existing pools
            if (pools.length > 0) {
                pools.forEach((pool, index) => {
                    const item = document.createElement('div');
                    item.className = 'custom-dropdown-item';
                    item.dataset.poolIndex = index;
                    item.innerHTML = `
                        <span>${pool.name}</span>
                        <span class="custom-dropdown-item-count">(${pool.files.length} ${type}${pool.files.length !== 1 ? 's' : ''})</span>
                    `;
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        selectPool(dropdown, pool, index);
                    });
                    list.appendChild(item);
                });
            }

            // Add "Create Pool" option
            const createItem = document.createElement('div');
            createItem.className = 'custom-dropdown-item create-pool';
            createItem.innerHTML = '<span>+ Create Pool</span>';
            createItem.addEventListener('click', (e) => {
                e.stopPropagation();
                openPoolModal(type, dropdown);
            });
            list.appendChild(createItem);
        }

        // ===== TRIM EDITOR MODAL FUNCTIONS =====

        let trimEditorFile = null;
        let trimEditorDuration = 0;
        let trimEditorStartTime = 0;
        let isDraggingSelection = false;
        let selectionDragStartX = 0;
        let selectionDragStartLeft = 0;

        // Open trim editor modal - LIGHTWEIGHT APPROACH
        function openTrimEditorModal(file, targetDuration) {
            trimEditorFile = file;
            trimEditorDuration = targetDuration;
            trimEditorStartTime = 0;

            const modal = document.getElementById('trimEditorModal');
            const previewVideo = document.getElementById('trimEditorPreviewVideo');
            const track = document.getElementById('trimEditorTrack');

            // Set video source
            previewVideo.src = file.data;

            const videoDuration = file.duration;

            // Calculate timeline width based on video duration (40px per second)
            const pixelsPerSecond = 40;
            const trackWidth = videoDuration * pixelsPerSecond;
            track.style.width = `${trackWidth}px`;

            // Clear previous content
            track.innerHTML = '';

            // Create time markers (simple vertical lines every second)
            const markersContainer = document.createElement('div');
            markersContainer.className = 'trim-editor-time-markers';

            for (let i = 0; i <= videoDuration; i++) {
                const marker = document.createElement('div');
                marker.className = 'trim-editor-time-marker';
                marker.textContent = `${i}s`;
                markersContainer.appendChild(marker);
            }
            track.appendChild(markersContainer);

            // Create overlay (covers everything)
            const overlay = document.createElement('div');
            overlay.className = 'trim-editor-timeline-overlay';
            track.appendChild(overlay);

            // Create selection window
            const selectionWidth = targetDuration * pixelsPerSecond;
            const selection = document.createElement('div');
            selection.className = 'trim-editor-selection';
            selection.style.left = '0px';
            selection.style.width = `${selectionWidth}px`;
            track.appendChild(selection);

            // Update overlay to reveal selected portion
            updateTrimEditorOverlay(0, targetDuration, videoDuration, pixelsPerSecond);

            // Add drag listeners
            const selectionDragHandler = (e) => startDraggingSelection(e, pixelsPerSecond, videoDuration);
            selection.addEventListener('mousedown', selectionDragHandler);

            modal.classList.add('open');
        }

        function startDraggingSelection(e, pixelsPerSecond, videoDuration) {
            isDraggingSelection = true;
            selectionDragStartX = e.clientX;
            const selection = document.querySelector('.trim-editor-selection');
            selectionDragStartLeft = parseFloat(selection.style.left) || 0;

            const dragHandler = (moveEvent) => dragSelection(moveEvent, pixelsPerSecond, videoDuration);
            document.addEventListener('mousemove', dragHandler);
            document.addEventListener('mouseup', () => stopDraggingSelection(dragHandler));
            e.preventDefault();
        }

        function dragSelection(e, pixelsPerSecond, videoDuration) {
            if (!isDraggingSelection) return;

            const deltaX = e.clientX - selectionDragStartX;
            const newLeft = selectionDragStartLeft + deltaX;

            const selection = document.querySelector('.trim-editor-selection');
            const track = document.getElementById('trimEditorTrack');
            const selectionWidth = parseFloat(selection.style.width);
            const trackWidth = parseFloat(track.style.width);
            const maxLeft = trackWidth - selectionWidth;

            // Constrain to bounds
            const constrainedLeft = Math.max(0, Math.min(newLeft, maxLeft));
            selection.style.left = `${constrainedLeft}px`;

            // Calculate start time based on position
            const startSecond = constrainedLeft / pixelsPerSecond;
            trimEditorStartTime = startSecond;

            // Update preview and overlay
            updateTrimEditorOverlay(startSecond, trimEditorDuration, videoDuration, pixelsPerSecond);

            // Update preview video to show selection start
            const previewVideo = document.getElementById('trimEditorPreviewVideo');
            previewVideo.currentTime = startSecond;
        }

        function stopDraggingSelection(dragHandler) {
            isDraggingSelection = false;
            document.removeEventListener('mousemove', dragHandler);
            document.removeEventListener('mouseup', () => stopDraggingSelection(dragHandler));
        }

        function updateTrimEditorOverlay(startTime, duration, videoDuration, pixelsPerSecond) {
            const overlay = document.querySelector('.trim-editor-timeline-overlay');
            if (!overlay) return;

            const startPx = startTime * pixelsPerSecond;
            const endPx = (startTime + duration) * pixelsPerSecond;

            // Create clip-path to reveal only the selected portion
            // Everything EXCEPT the selection is covered by overlay
            overlay.style.clipPath = `polygon(
                0% 0%,
                ${startPx}px 0%,
                ${startPx}px 100%,
                0% 100%,
                0% 0%,
                ${endPx}px 0%,
                ${endPx}px 100%,
                100% 100%,
                100% 0%
            )`;
        }

        function closeTrimEditorModal() {
            const modal = document.getElementById('trimEditorModal');
            modal.classList.remove('open');
            trimEditorFile = null;
            trimEditorDuration = 0;
            trimEditorStartTime = 0;
        }

        // ===== EXCLUDED VIDEO MODAL FUNCTIONS =====

        let excludedVideoFile = null;
        let excludedVideoElementDiv = null;
        let excludedVideoPool = null;

        function openExcludedVideoModal(file, elementDiv, pool) {
            excludedVideoFile = file;
            excludedVideoElementDiv = elementDiv;
            excludedVideoPool = pool;

            const modal = document.getElementById('excludedVideoModal');
            const previewVideo = document.getElementById('excludedVideoPreview');
            const loopBtn = document.getElementById('loopBtn');

            // Set video source
            previewVideo.src = file.data;

            // Set loop state based on file's loop property
            previewVideo.loop = file.loop || false;
            if (file.loop) {
                loopBtn.classList.add('active');
            } else {
                loopBtn.classList.remove('active');
            }

            modal.classList.add('open');
        }

        function closeExcludedVideoModal() {
            const modal = document.getElementById('excludedVideoModal');
            modal.classList.remove('open');
            excludedVideoFile = null;

            const previewVideo = document.getElementById('excludedVideoPreview');
            previewVideo.pause();
            previewVideo.currentTime = 0;
        }

        // Initialize timeline ruler
        function initializeTimelineRuler() {
            const ruler = document.getElementById('timelineRuler');
            const rulerContent = document.createElement('div');
            rulerContent.className = 'timeline-ruler-content';

            // Match the width exactly to the elements row
            const elementsRow = document.getElementById('elementsRow');
            rulerContent.style.width = '100%';
            rulerContent.style.display = 'flex';
            rulerContent.style.gap = '20px'; // Same gap as elements-row

            // Get all elements to calculate ruler segments
            const allElements = elementsRow.querySelectorAll('.timeline-element');

            allElements.forEach((element, index) => {
                const duration = parseInt(element.dataset.duration) || 5;
                const elementWidth = element.offsetWidth;

                // Create ruler segment for this element
                const segment = document.createElement('div');
                segment.style.width = `${elementWidth}px`;
                segment.style.minWidth = `${elementWidth}px`;
                segment.style.position = 'relative';
                segment.style.display = 'flex';

                // Calculate cumulative time
                const startSecond = index > 0 ? parseInt(allElements[index - 1].dataset.cumulativeEnd || 0) : 0;
                const endSecond = startSecond + duration;

                // Store cumulative end for next element
                element.dataset.cumulativeEnd = endSecond;

                // Add ticks for every second
                for (let sec = 0; sec <= duration; sec++) {
                    const tick = document.createElement('div');
                    const actualSecond = startSecond + sec;
                    const isMajor = actualSecond % 5 === 0;

                    // Skip tick at end of segment if it would duplicate with start of next segment
                    if (sec === duration && index < allElements.length - 1) {
                        continue;
                    }

                    tick.className = `timeline-tick ${isMajor ? 'major' : ''}`;
                    tick.style.position = 'absolute';
                    tick.style.left = `${(sec / duration) * elementWidth}px`;

                    tick.innerHTML = `
                        <div class="tick-mark"></div>
                        ${isMajor ? `<div class="tick-label">${actualSecond}s</div>` : ''}
                    `;

                    segment.appendChild(tick);
                }

                rulerContent.appendChild(segment);
            });

            ruler.innerHTML = '';
            ruler.appendChild(rulerContent);
        }

        // Show dropdown menu
        function showDropdown(button, event) {
            event.stopPropagation();

            const elementDiv = button.closest('.timeline-element');
            const elementId = elementDiv.dataset.elementId;

            // Remove any existing dropdowns
            document.querySelectorAll('.dropdown-menu').forEach(d => d.remove());

            const dropdown = document.createElement('div');
            dropdown.className = 'dropdown-menu';

            dropdown.innerHTML = `
                <div class="dropdown-item" data-type="video">
                    <span class="icon">🎬</span>
                    <span>Video</span>
                </div>
                <div class="dropdown-item" data-type="image">
                    <span class="icon">🖼️</span>
                    <span>Image</span>
                </div>
                <div class="dropdown-item" data-type="ai-video">
                    <span class="icon">✨</span>
                    <span>AI Video</span>
                </div>
                <div class="dropdown-item" data-type="ai-image">
                    <span class="icon">🎨</span>
                    <span>AI Image</span>
                </div>
            `;

            // Append to body first so we can measure it
            document.body.appendChild(dropdown);
            dropdown.style.position = 'fixed';
            dropdown.style.visibility = 'hidden'; // Hide temporarily to measure

            // Get button position and dropdown dimensions
            const rect = button.getBoundingClientRect();
            const dropdownRect = dropdown.getBoundingClientRect();
            const dropdownWidth = dropdownRect.width;
            const viewportWidth = window.innerWidth;
            const gap = 12;

            // Calculate position
            let leftPosition;
            
            // Check if dropdown would go off-screen to the right
            if (rect.right + gap + dropdownWidth > viewportWidth) {
                // Position to the left of the button
                leftPosition = rect.left - dropdownWidth - gap;
                // Make sure it doesn't go off the left edge
                if (leftPosition < 0) {
                    leftPosition = gap; // Fallback to left edge with gap
                }
            } else {
                // Position to the right of the button (default)
                leftPosition = rect.right + gap;
            }

            // Apply position and make visible
            dropdown.style.left = `${leftPosition}px`;
            dropdown.style.top = `${rect.top}px`;
            dropdown.style.visibility = 'visible';

            // Add click handlers
            dropdown.querySelectorAll('.dropdown-item').forEach(item => {
                item.addEventListener('click', () => {
                    const type = item.dataset.type;

                    // Set duration to 8 seconds for AI Video before showing form
                    if (type === 'ai-video') {
                        elementDiv.dataset.duration = '8';
                        updateElementWidth(elementDiv);
                    }

                    showElementForm(elementDiv, type, elementId);
                    dropdown.remove();
                });
            });

            // Close on click outside
            setTimeout(() => {
                document.addEventListener('click', function closeDropdown(e) {
                    if (!dropdown.contains(e.target)) {
                        dropdown.remove();
                        document.removeEventListener('click', closeDropdown);
                    }
                });
            }, 0);
        }

        // Show element form
        function showElementForm(elementDiv, type, elementId) {
            let content = elementDiv.querySelector('.element-content');
            
            // DEFENSIVE: If .element-content doesn't exist, create it
            if (!content) {
                console.warn(`[FORM ERROR] Element ${elementId} missing .element-content - creating it`);
                content = document.createElement('div');
                content.className = 'element-content';
                elementDiv.appendChild(content);
            }
            
            let formHTML = '';

            switch(type) {
                case 'video':
                    formHTML = `
                        <div class="element-form">
                            <div class="form-group">
                                <label>Video Source</label>
                                <input type="file" accept="video/*" class="video-upload" style="display:none;">
                                <div class="upload-btn" onclick="this.previousElementSibling.click()">
                                    Click to upload
                                    <div class="upload-preview video-preview" style="display: none;">
                                        <video class="preview-media" style="object-fit: cover;" muted></video>
                                    </div>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>Video Pool</label>
                                <div class="pool-dropdown-container"></div>
                            </div>
                            <div class="form-actions">
                                <button class="btn btn-secondary cancel-btn">Cancel</button>
                                <button class="btn btn-primary ok-btn">OK</button>
                            </div>
                        </div>
                    `;
                    break;

                case 'image':
                    formHTML = `
                        <div class="element-form">
                            <div class="form-group">
                                <label>Image Source</label>
                                <input type="file" accept="image/*" class="image-upload" style="display:none;">
                                <div class="upload-btn" onclick="this.previousElementSibling.click()">
                                    Click to upload
                                    <div class="upload-preview image-preview" style="display: none;">
                                        <img class="preview-media" src="" alt="Preview">
                                    </div>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>Image Pool</label>
                                <div class="pool-dropdown-container"></div>
                            </div>
                            <div class="form-actions">
                                <button class="btn btn-secondary cancel-btn">Cancel</button>
                                <button class="btn btn-primary ok-btn">OK</button>
                            </div>
                        </div>
                    `;
                    break;

                case 'ai-video':
                    const existingVideoConfig = elementDiv.dataset.aiVideoConfig ? JSON.parse(elementDiv.dataset.aiVideoConfig) : null;
                    formHTML = `
                        <div class="element-form">
                            <div class="form-group">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                    <label style="margin: 0;">Prompt *</label>
                                    <button
                                        type="button"
                                        class="add-variable-btn-inline"
                                        title="Add Variable"
                                        style="width: 22px; height: 22px; padding: 0; background: white; color: #6b7280; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; flex-shrink: 0; margin-left: auto;"
                                        onmouseenter="this.style.background='#f9fafb'; this.style.borderColor='#9ca3af'; this.style.color='#374151';"
                                        onmouseleave="this.style.background='white'; this.style.borderColor='#d1d5db'; this.style.color='#6b7280';"
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M6 4l-2 2v12l2 2"/>
                                            <path d="M18 4l2 2v12l-2 2"/>
                                            <line x1="9" y1="9" x2="15" y2="15" stroke-width="2.5"/>
                                            <line x1="15" y1="9" x2="9" y2="15" stroke-width="2.5"/>
                                        </svg>
                                    </button>
                                </div>
                                <textarea class="ai-video-prompt" placeholder="Describe the video..." rows="2">${existingVideoConfig?.prompt || ''}</textarea>
                            </div>
                            <div class="form-group">
                                <label>Model</label>
                                <div class="ai-video-model-dropdown"></div>
                            </div>
                            <div class="form-group">
                                <label>Duration</label>
                                <div class="ai-video-duration-dropdown"></div>
                            </div>
                            <div class="form-group">
                                <label style="display: flex; align-items: center; gap: 8px;">
                                    <input type="checkbox" class="video-trim-enabled" ${elementDiv.dataset.videoTrim ? 'checked' : ''} style="width: auto;">
                                    <span>Split Video (show only part of generated video)</span>
                                </label>
                            </div>
                            <div class="video-trim-controls" style="display: ${elementDiv.dataset.videoTrim ? 'block' : 'none'}; padding-left: 24px;">
                                <div class="form-group">
                                    <label>Video Source ID</label>
                                    <input type="text" class="video-source-id" placeholder="e.g., main-speaker" value="${elementDiv.dataset.videoSource || ''}" style="width: 100%; padding: 8px; border: 1px solid #d2d2d7; border-radius: 4px;">
                                    <small style="color: #86868b; font-size: 11px;">All elements with the same Source ID will use the same generated video</small>
                                </div>
                                <div class="form-group">
                                    <label>Show From (seconds)</label>
                                    <input type="number" class="video-trim-start" min="0" step="0.1" placeholder="0" value="${elementDiv.dataset.videoTrim ? JSON.parse(elementDiv.dataset.videoTrim).start : 0}" style="width: 100%; padding: 8px; border: 1px solid #d2d2d7; border-radius: 4px;">
                                </div>
                                <div class="form-group">
                                    <label>Show To (seconds)</label>
                                    <input type="number" class="video-trim-end" min="0" step="0.1" placeholder="5" value="${elementDiv.dataset.videoTrim ? JSON.parse(elementDiv.dataset.videoTrim).end : elementDiv.querySelector('.duration-value')?.textContent || 5}" style="width: 100%; padding: 8px; border: 1px solid #d2d2d7; border-radius: 4px;">
                                </div>
                                <small style="color: #86868b; font-size: 11px;">The full video will be generated once. Each element shows a different time range.</small>
                            </div>
                            <div class="form-group">
                                <label>Input Image (Optional)</label>
                                <input type="file" accept="image/*" class="ai-video-image-upload" style="display:none;">
                                <div class="upload-btn" onclick="this.previousElementSibling.click()">
                                    ${existingVideoConfig?.inputImageData ? 'Change Image' : 'Upload Image'}
                                    <div class="upload-preview ai-video-image-preview" style="display: none;">
                                        <img class="preview-media" src="" alt="Preview">
                                    </div>
                                </div>
                            </div>
                            <div class="form-actions">
                                <button class="btn btn-secondary cancel-btn">Cancel</button>
                                <button class="btn btn-primary ok-btn">OK</button>
                            </div>
                        </div>
                    `;
                    break;

                case 'ai-image':
                    const existingImageConfig = elementDiv.dataset.aiImageConfig ? JSON.parse(elementDiv.dataset.aiImageConfig) : null;
                    formHTML = `
                        <div class="element-form">
                            <div class="form-group">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                    <label style="margin: 0;">Prompt *</label>
                                    <button
                                        type="button"
                                        class="add-variable-btn-inline"
                                        title="Add Variable"
                                        style="width: 22px; height: 22px; padding: 0; background: white; color: #6b7280; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; flex-shrink: 0; margin-left: auto;"
                                        onmouseenter="this.style.background='#f9fafb'; this.style.borderColor='#9ca3af'; this.style.color='#374151';"
                                        onmouseleave="this.style.background='white'; this.style.borderColor='#d1d5db'; this.style.color='#6b7280';"
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M6 4l-2 2v12l2 2"/>
                                            <path d="M18 4l2 2v12l-2 2"/>
                                            <line x1="9" y1="9" x2="15" y2="15" stroke-width="2.5"/>
                                            <line x1="15" y1="9" x2="9" y2="15" stroke-width="2.5"/>
                                        </svg>
                                    </button>
                                </div>
                                <textarea class="ai-image-prompt" placeholder="Describe the image..." rows="3">${existingImageConfig?.prompt || ''}</textarea>
                            </div>
                            <div class="form-group">
                                <label>Model</label>
                                <div class="ai-image-model-dropdown"></div>
                            </div>
                            <div class="form-actions">
                                <button class="btn btn-secondary cancel-btn">Cancel</button>
                                <button class="btn btn-primary ok-btn">OK</button>
                            </div>
                        </div>
                    `;
                    break;
            }

            content.innerHTML = formHTML;

            // Inject pool dropdowns for Video
            if (type === 'video') {
                const poolContainer = content.querySelector('.pool-dropdown-container');
                const pools = videoPools.length > 0 ? videoPools : [];
                const poolDropdown = createPoolDropdown(pools, 'video');
                poolContainer.appendChild(poolDropdown);
            }

            // Inject pool dropdowns for Image
            if (type === 'image') {
                const poolContainer = content.querySelector('.pool-dropdown-container');
                const pools = imagePools.length > 0 ? imagePools : [];
                const poolDropdown = createPoolDropdown(pools, 'image');
                poolContainer.appendChild(poolDropdown);
            }

            // Inject custom dropdowns for AI Video
            if (type === 'ai-video') {
                const existingVideoConfig = elementDiv.dataset.aiVideoConfig ? JSON.parse(elementDiv.dataset.aiVideoConfig) : null;

                // Model dropdown
                const modelContainer = content.querySelector('.ai-video-model-dropdown');
                const modelOptions = [
                    { value: 'sora-2', label: 'Sora 2' },
                    { value: 'sora-2-pro', label: 'Sora 2 Pro' }
                ];
                const modelDropdown = createSimpleCustomDropdown(modelOptions, existingVideoConfig?.model || 'sora-2');
                modelContainer.appendChild(modelDropdown);

                // Duration dropdown
                const durationContainer = content.querySelector('.ai-video-duration-dropdown');
                const durationOptions = [
                    { value: '8', label: '8 seconds' },
                    { value: '12', label: '12 seconds' }
                ];
                const durationDropdown = createSimpleCustomDropdown(durationOptions, existingVideoConfig?.duration?.toString() || '8');
                durationContainer.appendChild(durationDropdown);
                
                // Show preview if existing image exists
                if (existingVideoConfig?.inputImageData) {
                    const preview = content.querySelector('.ai-video-image-preview');
                    const previewImg = preview ? preview.querySelector('.preview-media') : null;
                    if (preview && previewImg) {
                        previewImg.src = existingVideoConfig.inputImageData;
                        preview.style.display = 'block';
                        // Hide upload button text
                        const uploadBtn = preview.closest('.upload-btn');
                        if (uploadBtn) {
                            uploadBtn.style.color = 'transparent';
                        }
                    }
                }

                // Handle video trim checkbox toggle
                const trimCheckbox = content.querySelector('.video-trim-enabled');
                const trimControls = content.querySelector('.video-trim-controls');
                if (trimCheckbox && trimControls) {
                    trimCheckbox.addEventListener('change', () => {
                        trimControls.style.display = trimCheckbox.checked ? 'block' : 'none';
                    });
                }
            }

            // Inject custom dropdowns for AI Image
            if (type === 'ai-image') {
                const existingImageConfig = elementDiv.dataset.aiImageConfig ? JSON.parse(elementDiv.dataset.aiImageConfig) : null;

                // Model dropdown
                const modelContainer = content.querySelector('.ai-image-model-dropdown');
                const modelOptions = [
                    { value: 'gpt-5', label: 'GPT-5' },
                    { value: 'gpt-4.1', label: 'GPT-4.1' },
                    { value: 'dall-e-3', label: 'DALL-E 3' },
                    { value: 'dall-e-2', label: 'DALL-E 2' }
                ];
                const modelDropdown = createSimpleCustomDropdown(modelOptions, existingImageConfig?.model || 'gpt-5');
                modelContainer.appendChild(modelDropdown);
            }

            // Add event listeners for variable buttons in inline forms
            const addVariableBtn = content.querySelector('.add-variable-btn-inline');
            if (addVariableBtn) {
                const promptField = content.querySelector('.ai-video-prompt') || content.querySelector('.ai-image-prompt');
                if (promptField) {
                    addVariableBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showVariableDropdown(promptField, addVariableBtn);
                    });
                }
            }

            // Add event listeners
            const cancelBtn = content.querySelector('.cancel-btn');
            const okBtn = content.querySelector('.ok-btn');

            cancelBtn.addEventListener('click', () => {
                // Check if this element was previously finalized
                // If dataset.type exists, it means the element was finalized before editing
                const wasFinalized = elementDiv.dataset.type;

                if (wasFinalized) {
                    // Restore the element to its finalized state
                    finalizeElement(elementDiv, type, elementId);
                } else {
                    // New element - reset to "Add Element" state
                    // Reset duration to 5 seconds if it was AI Video
                    if (type === 'ai-video') {
                        elementDiv.dataset.duration = '5';
                        updateElementWidth(elementDiv);
                    }

                    content.innerHTML = `
                        <div class="add-element-btn">
                            <span class="icon">+</span>
                            <span class="label">Add Element</span>
                        </div>
                    `;
                    const newAddBtn = content.querySelector('.add-element-btn');
                    newAddBtn.addEventListener('click', (e) => showDropdown(newAddBtn, e));
                }
            });

            okBtn.addEventListener('click', () => {
                // Handle AI Video config
                if (type === 'ai-video') {
                    const prompt = content.querySelector('.ai-video-prompt')?.value.trim();
                    if (!prompt) {
                        alert('Please enter a prompt for the AI video');
                        return;
                    }

                    const modelDropdown = content.querySelector('.ai-video-model-dropdown .custom-dropdown');
                    const durationDropdown = content.querySelector('.ai-video-duration-dropdown .custom-dropdown');

                    const config = {
                        prompt: prompt,
                        model: modelDropdown?.dataset.selectedValue || 'sora-2',
                        duration: parseInt(durationDropdown?.dataset.selectedValue || '8'),
                        inputImageData: elementDiv.dataset.aiVideoInputImage || null,
                        size: '720x1280'
                    };

                    elementDiv.dataset.aiVideoConfig = JSON.stringify(config);
                    elementDiv.dataset.duration = config.duration;

                    // Handle video trim/split settings
                    const trimEnabled = content.querySelector('.video-trim-enabled')?.checked;
                    if (trimEnabled) {
                        const videoSource = content.querySelector('.video-source-id')?.value.trim();
                        const trimStart = parseFloat(content.querySelector('.video-trim-start')?.value || 0);
                        const trimEnd = parseFloat(content.querySelector('.video-trim-end')?.value || config.duration);

                        if (!videoSource) {
                            alert('Please enter a Video Source ID for split videos');
                            return;
                        }

                        elementDiv.dataset.videoSource = videoSource;
                        elementDiv.dataset.videoTrim = JSON.stringify({
                            start: trimStart,
                            end: trimEnd
                        });

                        // Update element duration to match trim length
                        const trimDuration = trimEnd - trimStart;
                        elementDiv.dataset.duration = trimDuration;
                    } else {
                        // Remove trim data if checkbox unchecked
                        delete elementDiv.dataset.videoSource;
                        delete elementDiv.dataset.videoTrim;
                    }

                    updateElementWidth(elementDiv);
                }

                // Handle AI Image config
                if (type === 'ai-image') {
                    const prompt = content.querySelector('.ai-image-prompt')?.value.trim();
                    if (!prompt) {
                        alert('Please enter a prompt for the AI image');
                        return;
                    }

                    const modelDropdown = content.querySelector('.ai-image-model-dropdown .custom-dropdown');

                    const config = {
                        prompt: prompt,
                        model: modelDropdown?.dataset.selectedValue || 'gpt-5',
                        quality: 'auto', // Always auto
                        size: '1024x1536',
                        format: 'png' // Always PNG
                    };

                    elementDiv.dataset.aiImageConfig = JSON.stringify(config);
                }

                // CRITICAL FIX: If this is the initial element, give it a new ID
                if (elementId === 'initial') {
                    const newElementId = `element-${nextElementId++}`;
                    console.log(`[ELEMENT FIX] Converting initial element to real element: ${newElementId}`);
                    elementDiv.dataset.elementId = newElementId;
                    elementDiv.classList.remove('add-element-btn');

                    // Create new "Add Element" button with proper structure
                    const elementsRow = document.getElementById('elementsRow');
                    const newAddBtn = document.createElement('div');
                    newAddBtn.className = 'timeline-element';
                    newAddBtn.dataset.elementId = 'initial';
                    newAddBtn.dataset.duration = '5';
                    newAddBtn.dataset.type = 'none';
                    newAddBtn.innerHTML = `
                        <div class="element-content">
                            <div class="add-element-btn">
                                <span class="icon">+</span>
                                <span class="label">Add Element</span>
                            </div>
                        </div>
                    `;
                    const addBtnInner = newAddBtn.querySelector('.add-element-btn');
                    addBtnInner.addEventListener('click', (e) => showDropdown(newAddBtn, e));
                    elementsRow.appendChild(newAddBtn);

                    console.log(`[ELEMENT FIX] Created new Add Element button`);

                    // Use the new element ID for finalization
                    finalizeElement(elementDiv, type, newElementId);
                } else {
                    finalizeElement(elementDiv, type, elementId);
                }
            });

            // Handle file uploads
            const videoUpload = content.querySelector('.video-upload');
            const imageUpload = content.querySelector('.image-upload');
            const aiVideoImageUpload = content.querySelector('.ai-video-image-upload');

            // Show existing previews if data exists
            if (type === 'video' && elementDiv.dataset.videoURL) {
                const preview = content.querySelector('.video-preview');
                const previewVideo = preview ? preview.querySelector('.preview-media') : null;
                if (preview && previewVideo) {
                    previewVideo.src = elementDiv.dataset.videoURL;
                    preview.style.display = 'block';
                    // Hide upload button text
                    const uploadBtn = preview.closest('.upload-btn');
                    if (uploadBtn) {
                        uploadBtn.style.color = 'transparent';
                    }
                }
            }
            
            if (type === 'image' && elementDiv.dataset.imageData) {
                const preview = content.querySelector('.image-preview');
                const previewImg = preview ? preview.querySelector('.preview-media') : null;
                if (preview && previewImg) {
                    previewImg.src = elementDiv.dataset.imageData;
                    preview.style.display = 'block';
                    // Hide upload button text
                    const uploadBtn = preview.closest('.upload-btn');
                    if (uploadBtn) {
                        uploadBtn.style.color = 'transparent';
                    }
                }
            }

            if (videoUpload) {
                videoUpload.addEventListener('change', (e) => handleVideoUpload(e, elementDiv));
            }
            if (imageUpload) {
                imageUpload.addEventListener('change', (e) => handleImageUpload(e, elementDiv));
            }
            if (aiVideoImageUpload) {
                aiVideoImageUpload.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            elementDiv.dataset.aiVideoInputImage = event.target.result;
                            
                            // Show preview
                            const preview = content.querySelector('.ai-video-image-preview');
                            const previewImg = preview ? preview.querySelector('.preview-media') : null;
                            if (preview && previewImg) {
                                previewImg.src = event.target.result;
                                preview.style.display = 'block';
                                // Hide upload button text
                                const uploadBtn = preview.closest('.upload-btn');
                                if (uploadBtn) {
                                    uploadBtn.style.color = 'transparent';
                                }
                            }
                        };
                        reader.readAsDataURL(file);
                    } else {
                        // Hide preview if no file selected
                        const preview = content.querySelector('.ai-video-image-preview');
                        if (preview) {
                            preview.style.display = 'none';
                            // Show upload button text again
                            const uploadBtn = preview.closest('.upload-btn');
                            if (uploadBtn) {
                                uploadBtn.style.color = '';
                            }
                        }
                    }
                });
            }

            // Handle AI Video duration change
            const aiVideoDuration = content.querySelector('.ai-video-duration');
            if (aiVideoDuration) {
                aiVideoDuration.addEventListener('change', (e) => {
                    elementDiv.dataset.duration = e.target.value;
                    updateElementWidth(elementDiv);
                });
            }
        }

        // Handle video upload
        async function handleVideoUpload(e, elementDiv) {
            const file = e.target.files[0];
            if (!file) return;

            // Show preview
            const preview = elementDiv.querySelector('.video-preview');
            const previewVideo = preview ? preview.querySelector('.preview-media') : null;
            if (preview && previewVideo) {
                const videoURL = URL.createObjectURL(file);
                previewVideo.src = videoURL;
                preview.style.display = 'block';
                // Hide upload button text
                const uploadBtn = preview.closest('.upload-btn');
                if (uploadBtn) {
                    uploadBtn.style.color = 'transparent';
                }
            }

            const video = document.createElement('video');
            const videoURL = URL.createObjectURL(file);
            video.src = videoURL;

            video.addEventListener('loadedmetadata', async () => {
                const duration = Math.ceil(video.duration);
                elementDiv.dataset.duration = duration;
                elementDiv.dataset.originalDuration = duration; // Store original for max resize check
                elementDiv.dataset.videoFile = file.name;
                elementDiv.dataset.videoURL = videoURL;

                console.log(`[VIDEO UPLOAD] ✓ Metadata loaded for ${elementDiv.dataset.elementId}: duration=${duration}s`);
                console.log(`[VIDEO UPLOAD] Current state: type=${elementDiv.dataset.type}, finalized=${elementDiv.dataset.finalized}`);

                // Store the File object for later export (attached as a property, not dataset)
                elementDiv._videoFile = file;

                // FIX ISSUE #2: Store video in IndexedDB with better error handling
                let mediaKey = null;
                let storageSucceeded = false;
                try {
                    console.log(`[VIDEO UPLOAD] Storing video in IndexedDB: ${file.name}`);
                    mediaKey = await storeMediaFile(file, 'video');
                    elementDiv.dataset.mediaKey = mediaKey;
                    storageSucceeded = true;
                    console.log(`[VIDEO UPLOAD] ✓ Video stored in IndexedDB with key: ${mediaKey}`);
                } catch (err) {
                    console.error('[VIDEO UPLOAD ERROR] Failed to store video in IndexedDB:', err);
                    // Set error flags but continue - element will still be finalized
                    elementDiv.dataset.storageError = 'true';
                    elementDiv.dataset.errorMessage = err.message;
                    elementDiv.dataset.mediaMissing = 'true';
                    alert(`Warning: Failed to store video in browser storage.\nVideo will appear in timeline but may not work after page refresh.\nError: ${err.message}`);
                }
                
                console.log(`[VIDEO UPLOAD] Pre-finalize state: type=${elementDiv.dataset.type}, finalized=${elementDiv.dataset.finalized}, mediaKey=${!!mediaKey}, storageSucceeded=${storageSucceeded}`);


                updateElementWidth(elementDiv);

                let elementId = elementDiv.dataset.elementId;

                // CRITICAL FIX: If this is the initial element, convert it to a real element
                if (elementId === 'initial') {
                    const newElementId = `element-${nextElementId++}`;
                    console.log(`[VIDEO UPLOAD FIX] Converting initial element to real element: ${newElementId}`);
                    elementDiv.dataset.elementId = newElementId;
                    elementDiv.classList.remove('add-element-btn');
                    elementId = newElementId; // Update local variable

                    // Create new "Add Element" button with proper structure
                    const elementsRow = document.getElementById('elementsRow');
                    const newAddBtn = document.createElement('div');
                    newAddBtn.className = 'timeline-element';
                    newAddBtn.dataset.elementId = 'initial';
                    newAddBtn.dataset.duration = '5';
                    newAddBtn.dataset.type = 'none';
                    newAddBtn.innerHTML = `
                        <div class="element-content">
                            <div class="add-element-btn">
                                <span class="icon">+</span>
                                <span class="label">Add Element</span>
                            </div>
                        </div>
                    `;
                    const addBtnInner = newAddBtn.querySelector('.add-element-btn');
                    addBtnInner.addEventListener('click', (e) => showDropdown(newAddBtn, e));
                    elementsRow.appendChild(newAddBtn);

                    console.log(`[VIDEO UPLOAD FIX] Created new Add Element button`);
                }

                // CRITICAL FIX: Finalize IMMEDIATELY so element is serializable right away
                // This decouples JSON serialization from frame extraction timing
                console.log(`[VIDEO UPLOAD] ✓ Finalizing element ${elementId} IMMEDIATELY (before frame extraction)`);
                try {
                    finalizeElement(elementDiv, 'video', elementId);
                    console.log(`[VIDEO UPLOAD] ✓ Element now serializable: type=${elementDiv.dataset.type}, finalized=${elementDiv.dataset.finalized}`);
                } catch (finalizeErr) {
                    console.error(`[VIDEO UPLOAD ERROR] Failed to finalize element ${elementId}:`, finalizeErr);
                    // FALLBACK: Manually set minimum required attributes for serialization
                    elementDiv.dataset.type = 'video';
                    elementDiv.dataset.finalized = 'true';
                    elementDiv.dataset.elementName = 'VIDEO (degraded)';
                    console.log(`[VIDEO UPLOAD RECOVERY] ✓ Element marked serializable despite finalize error`);
                }

                // Extract frames in background (element is already serializable)
                console.log(`[VIDEO UPLOAD] Starting background frame extraction for ${elementId}`);
                extractVideoFrames(video, duration, elementDiv).then(() => {
                    console.log(`[VIDEO UPLOAD] ✓ Frame extraction complete for ${elementId}`);
                    // Update preview with frames (without changing finalized state)
                    try {
                        updateVideoPreviewWithFrames(elementDiv);
                        console.log(`[VIDEO UPLOAD] ✓ Preview updated with frames for ${elementId}`);
                    } catch (previewErr) {
                        console.warn(`[VIDEO UPLOAD] Preview update failed for ${elementId}:`, previewErr);
                        // Element is still serializable
                    }
                }).catch(err => {
                    console.error(`[VIDEO UPLOAD ERROR] Frame extraction failed for ${elementId}:`, err);
                    // Element is still functional and serializable even without frames
                    console.log(`[VIDEO UPLOAD] Element ${elementId} remains serializable without frames`);
                });
            });
        }

        // Extract video frames at 5-second intervals
        async function extractVideoFrames(video, duration, elementDiv) {
            const elementId = elementDiv.dataset.elementId || 'unknown';
            console.log(`[FRAME EXTRACT] Starting extraction for ${elementId}, duration=${duration}s`);

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const frameCount = Math.max(1, Math.ceil(duration / 5));
            const frames = [];

            console.log(`[FRAME EXTRACT] Will extract ${frameCount} frames for ${elementId}`);

            // FIX ISSUE #3: Add timeout to prevent hanging forever
            const videoReadyPromise = new Promise((resolve) => {
                if (video.readyState >= 2) {
                    console.log(`[FRAME EXTRACT] Video already ready for ${elementId}`);
                    resolve(true);
                } else {
                    console.log(`[FRAME EXTRACT] Waiting for loadeddata event for ${elementId}`);
                    video.addEventListener('loadeddata', () => {
                        console.log(`[FRAME EXTRACT] ✓ loadeddata fired for ${elementId}`);
                        resolve(true);
                    }, { once: true });
                }
            });

            const timeoutPromise = new Promise((resolve) => {
                setTimeout(() => {
                    console.warn(`[FRAME EXTRACT ISSUE #3] Timeout waiting for video ready for ${elementId}`);
                    resolve(false);
                }, 10000); // 10 second timeout
            });

            const videoReady = await Promise.race([videoReadyPromise, timeoutPromise]);
            if (!videoReady) {
                console.error(`[FRAME EXTRACT ISSUE #3] Video never became ready for ${elementId} - aborting frame extraction`);
                return; // Exit without setting frames
            }

            // Set canvas to video dimensions
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            console.log(`[FRAME EXTRACT] Canvas size: ${canvas.width}x${canvas.height} for ${elementId}`);

            for (let i = 0; i < frameCount; i++) {
                const timestamp = Math.min(i * 5, duration - 0.1); // Avoid going past end

                console.log(`[FRAME EXTRACT] Extracting frame ${i + 1}/${frameCount} at ${timestamp}s for ${elementId}`);

                await new Promise((resolve) => {
                    const seekHandler = () => {
                        // Small delay to ensure frame is rendered
                        setTimeout(() => {
                            // Draw current frame to canvas
                            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                            // Convert to data URL
                            const frameDataURL = canvas.toDataURL('image/jpeg', 0.85);
                            frames.push(frameDataURL);
                            resolve();
                        }, 50);
                    };

                    video.addEventListener('seeked', seekHandler, { once: true });
                    video.currentTime = timestamp;
                });
            }

            // Store frames in element dataset
            elementDiv.dataset.videoFrames = JSON.stringify(frames);
            console.log(`[FRAME EXTRACT] ✓ Stored ${frames.length} frames for ${elementId}`);
        }

        // Handle image upload
        async function handleImageUpload(e, elementDiv) {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                elementDiv.dataset.imageFile = file.name;
                elementDiv.dataset.imageData = event.target.result;

                // Store image in IndexedDB and get key
                try {
                    const mediaKey = await storeMediaFile(file, 'image');
                    elementDiv.dataset.mediaKey = mediaKey;
                    console.log(`Image stored in IndexedDB with key: ${mediaKey}`);
                } catch (err) {
                    console.error('Failed to store image in IndexedDB:', err);
                }

                // Show preview
                const preview = elementDiv.querySelector('.image-preview');
                const previewImg = preview ? preview.querySelector('.preview-media') : null;
                if (preview && previewImg) {
                    previewImg.src = event.target.result;
                    preview.style.display = 'block';
                    // Hide upload button text
                    const uploadBtn = preview.closest('.upload-btn');
                    if (uploadBtn) {
                        uploadBtn.style.color = 'transparent';
                    }
                }

                // Automatically finalize the element
                let elementId = elementDiv.dataset.elementId;

                // CRITICAL FIX: If this is the initial element, convert it to a real element
                if (elementId === 'initial') {
                    const newElementId = `element-${nextElementId++}`;
                    console.log(`[IMAGE UPLOAD FIX] Converting initial element to real element: ${newElementId}`);
                    elementDiv.dataset.elementId = newElementId;
                    elementDiv.classList.remove('add-element-btn');
                    elementId = newElementId; // Update local variable

                    // Create new "Add Element" button with proper structure
                    const elementsRow = document.getElementById('elementsRow');
                    const newAddBtn = document.createElement('div');
                    newAddBtn.className = 'timeline-element';
                    newAddBtn.dataset.elementId = 'initial';
                    newAddBtn.dataset.duration = '5';
                    newAddBtn.dataset.type = 'none';
                    newAddBtn.innerHTML = `
                        <div class="element-content">
                            <div class="add-element-btn">
                                <span class="icon">+</span>
                                <span class="label">Add Element</span>
                            </div>
                        </div>
                    `;
                    const addBtnInner = newAddBtn.querySelector('.add-element-btn');
                    addBtnInner.addEventListener('click', (e) => showDropdown(newAddBtn, e));
                    elementsRow.appendChild(newAddBtn);

                    console.log(`[IMAGE UPLOAD FIX] Created new Add Element button`);
                }

                finalizeElement(elementDiv, 'image', elementId);
            };
            reader.readAsDataURL(file);
        }

        // Helper function to position edit button right after badge
        function positionEditButtonAfterBadge(elementDiv) {
            const editBtn = elementDiv.querySelector('.edit-btn');
            const badge = elementDiv.querySelector('.element-type-badge');
            if (editBtn && badge) {
                const badgeRect = badge.getBoundingClientRect();
                const elementRect = elementDiv.getBoundingClientRect();
                // Position edit button: aligned with badge left edge, below badge with 4px gap
                editBtn.style.left = `${badgeRect.left - elementRect.left}px`;
                editBtn.style.top = `${badgeRect.bottom - elementRect.top + 4}px`;
                editBtn.style.transform = 'none';
            }
        }

        // Show edit text modal at bottom-right of cursor
        function showEditTextModal(e, editElement) {
            const modal = document.getElementById('editTextModal');
            const canvas = document.getElementById('editTextCanvas');

            if (!modal || !canvas) {
                console.error('Modal or canvas not found!');
                alert('Error: Modal elements not found in DOM');
                return;
            }

            const ctx = canvas.getContext('2d');

            // State management
            let edits = []; // Array of {type: 'text'|'image', data: {...}}
            let selectedEditIndex = null;
            let isDraggingEdit = false;
            let dragOffset = { x: 0, y: 0 };

            // Load existing edits if re-editing
            if (editElement.dataset.editsData) {
                try {
                    edits = JSON.parse(editElement.dataset.editsData);
                    console.log('Loaded existing edits:', edits);
                } catch (e) {
                    console.error('Error loading existing edits:', e);
                }
            }

            // Position modal at bottom-right of cursor
            modal.style.display = 'block';
            const modalWidth = 620; // Match CSS width
            const modalHeight = 450; // Approximate height
            const gap = 10; // Small gap from cursor

            let left = e.clientX + gap;
            let top = e.clientY + gap;

            // Keep modal within viewport bounds
            if (left + modalWidth > window.innerWidth) {
                left = e.clientX - modalWidth - gap;
            }
            if (top + modalHeight > window.innerHeight) {
                top = window.innerHeight - modalHeight - gap;
            }
            if (left < gap) left = gap;
            if (top < gap) top = gap;

            modal.style.left = left + 'px';
            modal.style.top = top + 'px';
            modal.style.transform = 'none';

            // Get all timeline elements for binding dropdown (removed from UI, kept for compatibility)
            const elementBindingSelect = document.getElementById('editElementBinding');
            if (elementBindingSelect) {
                elementBindingSelect.innerHTML = '<option value="">None (absolute timing)</option>';
            }

            const timelineElements = document.querySelectorAll('.timeline-element');
            if (elementBindingSelect) {
                timelineElements.forEach(el => {
                    const type = el.dataset.type || 'element';
                    const id = el.dataset.elementId || 'unknown';
                    const option = document.createElement('option');
                    option.value = id;
                    option.textContent = `${type} #${id}`;
                    elementBindingSelect.appendChild(option);
                });
            }

            // Get all control elements
            const createEditBtn = document.getElementById('createEditBtn');
            const editTextContent = document.getElementById('editTextContent'); // Removed from UI but kept for compatibility
            const editFontFamily = document.getElementById('editFontFamily');
            const editFontSize = document.getElementById('editFontSize');
            const editFontColor = document.getElementById('editFontColor');
            const editStrokeWidth = document.getElementById('editStrokeWidth');
            const editStrokeColor = document.getElementById('editStrokeColor');
            const textAlignLeft = document.getElementById('textAlignLeft');
            const textAlignCenter = document.getElementById('textAlignCenter');
            const textAlignRight = document.getElementById('textAlignRight');
            const editsList = document.getElementById('editsList');
            const addImageBtn = document.getElementById('addImageBtn');
            const editImageUpload = document.getElementById('editImageUpload');
            const okBtn = document.getElementById('editTextOk');
            const cancelBtn = document.getElementById('editTextCancel');

            // Helper function to wrap text and return lines
            function wrapText(text, maxWidth) {
                const words = text.split(' ');
                const lines = [];
                let currentLine = '';

                for (let i = 0; i < words.length; i++) {
                    const testLine = currentLine + (currentLine ? ' ' : '') + words[i];
                    const metrics = ctx.measureText(testLine);

                    if (metrics.width > maxWidth && currentLine) {
                        lines.push(currentLine);
                        currentLine = words[i];
                    } else {
                        currentLine = testLine;
                    }
                }

                if (currentLine) {
                    lines.push(currentLine);
                }

                return lines;
            }

            // Render canvas with all edits
            function renderCanvas() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                edits.forEach((edit, index) => {
                    if (edit.type === 'text') {
                        const data = edit.data;

                        // In edit mode, show raw text with {variables}
                        // Variables will be resolved during preview playback
                        const displayText = data.text;

                        // Apply text styling
                        ctx.font = `${data.size}px ${data.fontFamily}`;
                        ctx.textAlign = data.align || 'left';
                        ctx.textBaseline = 'top';

                        // Calculate X position based on alignment
                        let textX = data.x;
                        const margin = 10;
                        const maxWidth = canvas.width - (margin * 2);
                        const lines = wrapText(displayText, maxWidth);
                        let maxLineWidth = 0;
                        lines.forEach(line => {
                            const metrics = ctx.measureText(line);
                            maxLineWidth = Math.max(maxLineWidth, metrics.width);
                        });
                        
                        // Adjust X position based on alignment
                        if (data.align === 'center') {
                            textX = canvas.width / 2;
                        } else if (data.align === 'right') {
                            textX = canvas.width - margin;
                        } else {
                            textX = data.x || margin;
                        }

                        const lineHeight = data.size * 1.2; // 1.2 line spacing

                        // Render each line
                        lines.forEach((line, lineIndex) => {
                            const lineY = data.y + (lineIndex * lineHeight);
                            
                            // Calculate X position for this line based on alignment
                            let lineX = textX;
                            if (data.align === 'center') {
                                const metrics = ctx.measureText(line);
                                lineX = canvas.width / 2;
                            } else if (data.align === 'right') {
                                lineX = canvas.width - margin;
                            }

                            // Apply stroke
                            if (data.strokeWidth > 0) {
                                ctx.strokeStyle = data.strokeColor;
                                ctx.lineWidth = data.strokeWidth;
                                ctx.strokeText(line, lineX, lineY);
                            }

                            // Fill text
                            ctx.fillStyle = data.color;
                            ctx.fillText(line, lineX, lineY);
                        });

                        // Draw selection highlight
                        if (selectedEditIndex === index) {
                            const totalHeight = lines.length * lineHeight;
                            
                            // Calculate bounding box based on alignment
                            let highlightX = textX - 4;
                            if (data.align === 'center') {
                                highlightX = (canvas.width / 2) - (maxLineWidth / 2) - 4;
                            } else if (data.align === 'right') {
                                highlightX = (canvas.width - margin) - maxLineWidth - 4;
                            }

                            ctx.strokeStyle = '#0066ff';
                            ctx.lineWidth = 2;
                            ctx.strokeRect(
                                highlightX,
                                data.y - 4,
                                maxLineWidth + 8,
                                totalHeight + 8
                            );
                        }
                    } else if (edit.type === 'image') {
                        const data = edit.data;

                        if (data.imageElement && data.imageElement.complete) {
                            ctx.drawImage(
                                data.imageElement,
                                data.x - data.width / 2,
                                data.y - data.height / 2,
                                data.width,
                                data.height
                            );

                            // Draw selection highlight
                            if (selectedEditIndex === index) {
                                ctx.strokeStyle = '#0066ff';
                                ctx.lineWidth = 2;
                                ctx.strokeRect(
                                    data.x - data.width / 2 - 4,
                                    data.y - data.height / 2 - 4,
                                    data.width + 8,
                                    data.height + 8
                                );
                            }
                        }
                    }
                });
            }

            // Update edit list display
            function updateEditsList() {
                editsList.innerHTML = '';

                edits.forEach((edit, index) => {
                    const editItem = document.createElement('div');
                    editItem.className = 'edit-list-item';
                    if (selectedEditIndex === index) {
                        editItem.classList.add('selected');
                    }

                    // Row 1: Text content (full width)
                    const label = document.createElement('div');
                    label.className = 'edit-list-item-content';
                    label.textContent = edit.type === 'text'
                        ? (edit.data.text || 'New Text')
                        : `Image ${index + 1}`;

                    // Delete button (top right)
                    const deleteBtn = document.createElement('span');
                    deleteBtn.innerHTML = '×';
                    deleteBtn.className = 'delete-edit-btn';
                    deleteBtn.title = 'Delete';
                    deleteBtn.onclick = (e) => {
                        e.stopPropagation();
                        edits.splice(index, 1);
                        if (selectedEditIndex === index) {
                            selectedEditIndex = null;
                            if (editTextContent) editTextContent.value = '';
                        } else if (selectedEditIndex > index) {
                            selectedEditIndex--;
                        }
                        updateEditsList();
                        renderCanvas();
                    };

                    // Row 2: Controls grid (3 columns)
                    const controls = document.createElement('div');
                    controls.className = 'edit-list-item-controls';

                    // Column 1: Start time
                    const startControl = document.createElement('div');
                    startControl.className = 'edit-list-item-control';
                    const startLabel = document.createElement('label');
                    startLabel.textContent = 'Start';
                    const startInput = document.createElement('input');
                    startInput.type = 'number';
                    startInput.step = '0.1';
                    startInput.value = edit.startTime || 0;
                    startInput.onclick = (e) => e.stopPropagation();
                    startInput.oninput = (e) => {
                        edit.startTime = parseFloat(e.target.value) || 0;
                    };
                    startControl.appendChild(startLabel);
                    startControl.appendChild(startInput);

                    // Column 2: Duration
                    const durControl = document.createElement('div');
                    durControl.className = 'edit-list-item-control';
                    const durLabel = document.createElement('label');
                    durLabel.textContent = 'Duration';
                    const durInput = document.createElement('input');
                    durInput.type = 'number';
                    durInput.step = '0.1';
                    durInput.value = (edit.endTime || 5) - (edit.startTime || 0);
                    durInput.onclick = (e) => e.stopPropagation();
                    durInput.oninput = (e) => {
                        const duration = parseFloat(e.target.value) || 0;
                        edit.endTime = (edit.startTime || 0) + duration;
                    };
                    durControl.appendChild(durLabel);
                    durControl.appendChild(durInput);

                    // Column 3: Vertical three-dot menu
                    const menuBtn = document.createElement('div');
                    menuBtn.innerHTML = '⋮';
                    menuBtn.className = 'edit-menu-btn';
                    menuBtn.title = 'Options';
                    menuBtn.onclick = (e) => {
                        e.stopPropagation();
                        // Close all other binding menus
                        document.querySelectorAll('.edit-binding-menu').forEach(m => {
                            if (m !== editItem.querySelector('.edit-binding-menu')) {
                                m.classList.remove('open');
                            }
                        });
                        // Toggle binding menu
                        const menu = editItem.querySelector('.edit-binding-menu');
                        menu.classList.toggle('open');
                    };

                    controls.appendChild(startControl);
                    controls.appendChild(durControl);
                    controls.appendChild(menuBtn);

                    // Binding menu (hidden by default) - styled like custom dropdown
                    const bindingMenu = document.createElement('div');
                    bindingMenu.className = 'edit-binding-menu';
                    
                    // Function to update selected state in binding menu
                    const updateBindingMenuSelection = () => {
                        const items = bindingMenu.querySelectorAll('.edit-binding-menu-item');
                        items.forEach(item => {
                            item.classList.remove('selected');
                            if (item.textContent === 'None (absolute timing)' && !edit.boundTo) {
                                item.classList.add('selected');
                            } else if (item.textContent !== 'None (absolute timing)') {
                                const id = item.textContent.match(/#(\w+)/)?.[1];
                                if (id && edit.boundTo === id) {
                                    item.classList.add('selected');
                                }
                            }
                        });
                    };
                    
                    // Add "None" option
                    const noneItem = document.createElement('div');
                    noneItem.className = 'edit-binding-menu-item';
                    noneItem.textContent = 'None (absolute timing)';
                    if (!edit.boundTo) noneItem.classList.add('selected');
                    noneItem.onclick = (e) => {
                        e.stopPropagation();
                        edit.boundTo = '';
                        updateBindingMenuSelection();
                        bindingMenu.classList.remove('open');
                        updateEditsList();
                    };
                    bindingMenu.appendChild(noneItem);

                    // Add timeline elements to dropdown
                    const timelineElements = document.querySelectorAll('.timeline-element');
                    timelineElements.forEach(el => {
                        const type = el.dataset.type || 'element';
                        const id = el.dataset.elementId || 'unknown';
                        const menuItem = document.createElement('div');
                        menuItem.className = 'edit-binding-menu-item';
                        menuItem.textContent = `${type} #${id}`;
                        if (edit.boundTo === id) menuItem.classList.add('selected');
                        menuItem.onclick = (e) => {
                            e.stopPropagation();
                            edit.boundTo = id;
                            updateBindingMenuSelection();
                            bindingMenu.classList.remove('open');
                            updateEditsList();
                        };
                        bindingMenu.appendChild(menuItem);
                    });

                    editItem.appendChild(label);
                    editItem.appendChild(deleteBtn);
                    editItem.appendChild(controls);
                    editItem.appendChild(bindingMenu);

                    editItem.onclick = () => {
                        selectedEditIndex = index;

                        // Update controls if text is selected
                        if (edit.type === 'text') {
                            if (editTextContent) editTextContent.value = edit.data.text;
                            editFontFamily.value = edit.data.fontFamily;
                            editFontSize.value = edit.data.size;
                            editFontColor.value = edit.data.color;
                            editStrokeWidth.value = edit.data.strokeWidth;
                            editStrokeColor.value = edit.data.strokeColor;
                            
                            // Update alignment buttons
                            const align = edit.data.align || 'center';
                            textAlignLeft.classList.toggle('active', align === 'left');
                            textAlignCenter.classList.toggle('active', align === 'center');
                            textAlignRight.classList.toggle('active', align === 'right');
                            
                            // Show transparent input field and select all text
                            const rect = canvas.getBoundingClientRect();
                            const data = edit.data;
                            
                            // Calculate text bounds for positioning
                            ctx.font = `${data.size}px ${data.fontFamily}`;
                            const margin = 10;
                            const maxWidth = canvas.width - (margin * 2);
                            const lines = wrapText(data.text, maxWidth);
                            const lineHeight = data.size * 1.2;
                            
                            let maxLineWidth = 0;
                            lines.forEach(line => {
                                const metrics = ctx.measureText(line);
                                maxLineWidth = Math.max(maxLineWidth, metrics.width);
                            });
                            
                            // Calculate X position based on alignment
                            let textX = data.x;
                            if (data.align === 'center') {
                                textX = canvas.width / 2;
                            } else if (data.align === 'right') {
                                textX = canvas.width - margin;
                            } else {
                                textX = data.x || margin;
                            }
                            
                            // Remove any existing input first
                            const existingInput = document.querySelector('input[style*="opacity: 0"]');
                            if (existingInput && existingInput.parentNode) {
                                existingInput.parentNode.removeChild(existingInput);
                            }
                            
                            // Create inline text input (invisible)
                            const input = document.createElement('input');
                            input.type = 'text';
                            input.value = data.text;
                            input.style.position = 'absolute';
                            input.style.left = `${rect.left + textX}px`;
                            input.style.top = `${rect.top + data.y}px`;
                            input.style.fontSize = `${data.size}px`;
                            input.style.fontFamily = data.fontFamily;
                            input.style.color = data.color;
                            input.style.backgroundColor = 'transparent';
                            input.style.border = 'none';
                            input.style.outline = 'none';
                            input.style.opacity = '0';
                            input.style.zIndex = '10001';
                            input.style.minWidth = `${maxLineWidth + 20}px`;
                            input.style.caretColor = data.color;
                            
                            document.body.appendChild(input);
                            input.focus();
                            input.select(); // Select all text so typing replaces it
                            
                            // Update text on input
                            input.oninput = () => {
                                data.text = input.value;
                                renderCanvas();
                                updateEditsList();
                            };
                            
                            // Remove input on blur or Enter
                            const removeInput = () => {
                                if (input.parentNode) {
                                    input.parentNode.removeChild(input);
                                }
                            };
                            
                            input.onblur = removeInput;
                            input.onkeydown = (evt) => {
                                if (evt.key === 'Enter') {
                                    removeInput();
                                }
                                if (evt.key === 'Escape') {
                                    input.value = data.text; // Revert
                                    removeInput();
                                }
                            };
                        }

                        updateEditsList();
                        renderCanvas();
                    };

                    editsList.appendChild(editItem);
                });
            }

            // Create new text edit
            createEditBtn.onclick = () => {
                const newEdit = {
                    type: 'text',
                    startTime: 0,
                    endTime: 5,
                    data: {
                        text: 'New Text',
                        x: 50,
                        y: canvas.height / 2,
                        size: parseInt(editFontSize.value),
                        fontFamily: editFontFamily.value,
                        color: editFontColor.value,
                        strokeWidth: parseInt(editStrokeWidth.value),
                        strokeColor: editStrokeColor.value,
                        align: 'center'
                    }
                };

                edits.push(newEdit);
                selectedEditIndex = edits.length - 1;

                // Update controls
                if (editTextContent) editTextContent.value = newEdit.data.text;

                updateEditsList();
                renderCanvas();
                
                // Remove any existing input first
                const existingInput = document.querySelector('input[style*="opacity: 0"]');
                if (existingInput && existingInput.parentNode) {
                    existingInput.parentNode.removeChild(existingInput);
                }
                
                // Show transparent input field and select all text
                const rect = canvas.getBoundingClientRect();
                const data = newEdit.data;
                
                // Calculate text bounds for positioning
                ctx.font = `${data.size}px ${data.fontFamily}`;
                const margin = 10;
                const maxWidth = canvas.width - (margin * 2);
                const lines = wrapText(data.text, maxWidth);
                const lineHeight = data.size * 1.2;
                
                let maxLineWidth = 0;
                lines.forEach(line => {
                    const metrics = ctx.measureText(line);
                    maxLineWidth = Math.max(maxLineWidth, metrics.width);
                });
                
                // Calculate X position based on alignment
                let textX = data.x;
                if (data.align === 'center') {
                    textX = canvas.width / 2;
                } else if (data.align === 'right') {
                    textX = canvas.width - margin;
                } else {
                    textX = data.x || margin;
                }
                
                // Create inline text input (invisible)
                const input = document.createElement('input');
                input.type = 'text';
                input.value = data.text;
                input.style.position = 'absolute';
                input.style.left = `${rect.left + textX}px`;
                input.style.top = `${rect.top + data.y}px`;
                input.style.fontSize = `${data.size}px`;
                input.style.fontFamily = data.fontFamily;
                input.style.color = data.color;
                input.style.backgroundColor = 'transparent';
                input.style.border = 'none';
                input.style.outline = 'none';
                input.style.opacity = '0';
                input.style.zIndex = '10001';
                input.style.minWidth = `${maxLineWidth + 20}px`;
                input.style.caretColor = data.color;
                
                document.body.appendChild(input);
                input.focus();
                input.select(); // Select all text so typing replaces it
                
                // Update text on input
                input.oninput = () => {
                    data.text = input.value;
                    renderCanvas();
                    updateEditsList();
                };
                
                // Remove input on blur or Enter
                const removeInput = () => {
                    if (input.parentNode) {
                        input.parentNode.removeChild(input);
                    }
                };
                
                input.onblur = removeInput;
                input.onkeydown = (evt) => {
                    if (evt.key === 'Enter') {
                        removeInput();
                    }
                    if (evt.key === 'Escape') {
                        input.value = data.text; // Revert
                        removeInput();
                    }
                };
            };

            // Two-way sync: text input updates canvas
            const updateSelectedText = () => {
                if (selectedEditIndex !== null && edits[selectedEditIndex]?.type === 'text') {
                    const data = edits[selectedEditIndex].data;
                    if (editTextContent) data.text = editTextContent.value;
                    data.size = parseInt(editFontSize.value);
                    data.fontFamily = editFontFamily.value;
                    data.color = editFontColor.value;
                    data.strokeWidth = parseInt(editStrokeWidth.value);
                    data.strokeColor = editStrokeColor.value;

                    updateEditsList();
                    renderCanvas();
                }
            };

            if (editTextContent) editTextContent.oninput = updateSelectedText;
            editFontFamily.onchange = updateSelectedText;
            editFontSize.oninput = updateSelectedText;
            editFontColor.oninput = updateSelectedText;
            editStrokeWidth.oninput = updateSelectedText;
            editStrokeColor.oninput = updateSelectedText;
            
            // Text alignment button handlers
            textAlignLeft.onclick = () => {
                if (selectedEditIndex !== null && edits[selectedEditIndex]?.type === 'text') {
                    edits[selectedEditIndex].data.align = 'left';
                    textAlignLeft.classList.add('active');
                    textAlignCenter.classList.remove('active');
                    textAlignRight.classList.remove('active');
                    updateEditsList();
                    renderCanvas();
                }
            };
            
            textAlignCenter.onclick = () => {
                if (selectedEditIndex !== null && edits[selectedEditIndex]?.type === 'text') {
                    edits[selectedEditIndex].data.align = 'center';
                    textAlignLeft.classList.remove('active');
                    textAlignCenter.classList.add('active');
                    textAlignRight.classList.remove('active');
                    updateEditsList();
                    renderCanvas();
                }
            };
            
            textAlignRight.onclick = () => {
                if (selectedEditIndex !== null && edits[selectedEditIndex]?.type === 'text') {
                    edits[selectedEditIndex].data.align = 'right';
                    textAlignLeft.classList.remove('active');
                    textAlignCenter.classList.remove('active');
                    textAlignRight.classList.add('active');
                    updateEditsList();
                    renderCanvas();
                }
            };

            // Canvas interaction - click to select, drag to move
            canvas.onmousedown = (e) => {
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                selectedEditIndex = null;

                // Check in reverse order (top to bottom)
                for (let i = edits.length - 1; i >= 0; i--) {
                    const edit = edits[i];

                    if (edit.type === 'text') {
                        const data = edit.data;
                        ctx.font = `${data.size}px ${data.fontFamily}`;
                        ctx.textAlign = data.align || 'center';

                        // Wrap text to get accurate bounds
                        const margin = 10;
                        const maxWidth = canvas.width - (margin * 2);
                        const lines = wrapText(data.text, maxWidth);
                        const lineHeight = data.size * 1.2;

                        let maxLineWidth = 0;
                        lines.forEach(line => {
                            const metrics = ctx.measureText(line);
                            maxLineWidth = Math.max(maxLineWidth, metrics.width);
                        });
                        const totalHeight = lines.length * lineHeight;

                        // Simple hit box - text is always left-aligned at data.x
                        if (x >= data.x - 4 &&
                            x <= data.x + maxLineWidth + 4 &&
                            y >= data.y - 4 &&
                            y <= data.y + totalHeight + 4) {
                            selectedEditIndex = i;
                            isDraggingEdit = true;
                            dragOffset = { x: x - data.x, y: y - data.y };

                            // Update text input
                            if (editTextContent) editTextContent.value = data.text;
                            editFontFamily.value = data.fontFamily;
                            editFontSize.value = data.size;
                            editFontColor.value = data.color;
                            editStrokeWidth.value = data.strokeWidth;
                            editStrokeColor.value = data.strokeColor;
                            
                            // Update alignment buttons
                            const align = data.align || 'center';
                            textAlignLeft.classList.toggle('active', align === 'left');
                            textAlignCenter.classList.toggle('active', align === 'center');
                            textAlignRight.classList.toggle('active', align === 'right');

                            break;
                        }
                    } else if (edit.type === 'image') {
                        const data = edit.data;

                        if (x >= data.x - data.width / 2 - 4 &&
                            x <= data.x + data.width / 2 + 4 &&
                            y >= data.y - data.height / 2 - 4 &&
                            y <= data.y + data.height / 2 + 4) {
                            selectedEditIndex = i;
                            isDraggingEdit = true;
                            dragOffset = { x: x - data.x, y: y - data.y };
                            break;
                        }
                    }
                }

                updateEditsList();
                renderCanvas();
            };

            canvas.onmousemove = (e) => {
                if (isDraggingEdit && selectedEditIndex !== null) {
                    const rect = canvas.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;

                    // Free positioning for both text and images
                    edits[selectedEditIndex].data.x = x - dragOffset.x;
                    edits[selectedEditIndex].data.y = y - dragOffset.y;

                    // When dragging text, change alignment to 'left' to allow free horizontal positioning
                    if (edits[selectedEditIndex].type === 'text') {
                        edits[selectedEditIndex].data.align = 'left';

                        // Update alignment buttons
                        textAlignLeft.classList.add('active');
                        textAlignCenter.classList.remove('active');
                        textAlignRight.classList.remove('active');
                    }

                    renderCanvas();
                    updateEditsList();
                }
            };

            canvas.onmouseup = () => {
                isDraggingEdit = false;
            };

            // Double-click to edit text inline
            canvas.ondblclick = (e) => {
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                // Find which text edit was double-clicked
                for (let i = edits.length - 1; i >= 0; i--) {
                    const edit = edits[i];

                    if (edit.type === 'text') {
                        const data = edit.data;

                        // Calculate text bounds
                        ctx.font = `${data.size}px ${data.fontFamily}`;
                        const margin = 10;
                        const maxWidth = canvas.width - (margin * 2);
                        const lines = wrapText(data.text, maxWidth);
                        const lineHeight = data.size * 1.2;

                        let maxLineWidth = 0;
                        lines.forEach(line => {
                            const metrics = ctx.measureText(line);
                            maxLineWidth = Math.max(maxLineWidth, metrics.width);
                        });
                        const totalHeight = lines.length * lineHeight;

                        // Check if click is within text bounds
                        if (x >= data.x - 4 &&
                            x <= data.x + maxLineWidth + 4 &&
                            y >= data.y - 4 &&
                            y <= data.y + totalHeight + 4) {

                            // Create inline text input (invisible)
                            const input = document.createElement('input');
                            input.type = 'text';
                            input.value = data.text;
                            input.style.position = 'absolute';
                            input.style.left = `${rect.left + data.x}px`;
                            input.style.top = `${rect.top + data.y}px`;
                            input.style.fontSize = `${data.size}px`;
                            input.style.fontFamily = data.fontFamily;
                            input.style.color = data.color;
                            input.style.backgroundColor = 'transparent';
                            input.style.border = 'none';
                            input.style.outline = 'none';
                            input.style.opacity = '0';
                            input.style.zIndex = '10001';
                            input.style.minWidth = `${maxLineWidth + 20}px`;
                            input.style.caretColor = data.color;

                            document.body.appendChild(input);
                            input.focus();
                            input.select();

                            // Update text on input
                            input.oninput = () => {
                                data.text = input.value;
                                renderCanvas();
                                updateEditsList();
                            };

                            // Remove input on blur or Enter
                            const removeInput = () => {
                                if (input.parentNode) {
                                    input.parentNode.removeChild(input);
                                }
                            };

                            input.onblur = removeInput;
                            input.onkeydown = (evt) => {
                                if (evt.key === 'Enter') {
                                    removeInput();
                                }
                                if (evt.key === 'Escape') {
                                    input.value = data.text; // Revert
                                    removeInput();
                                }
                            };

                            break;
                        }
                    }
                }
            };

            // Add image button
            addImageBtn.onclick = () => {
                editImageUpload.click();
            };

            editImageUpload.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const img = new Image();
                        img.onload = () => {
                            // Calculate size to fit within canvas
                            let width = img.width;
                            let height = img.height;
                            const maxWidth = canvas.width * 0.8;
                            const maxHeight = canvas.height * 0.4;

                            if (width > maxWidth) {
                                height = (maxWidth / width) * height;
                                width = maxWidth;
                            }
                            if (height > maxHeight) {
                                width = (maxHeight / height) * width;
                                height = maxHeight;
                            }

                            const newEdit = {
                                type: 'image',
                                startTime: 0,
                                endTime: 5,
                                data: {
                                    imageElement: img,
                                    x: canvas.width / 2,
                                    y: canvas.height / 2,
                                    width: width,
                                    height: height
                                }
                            };

                            edits.push(newEdit);
                            selectedEditIndex = edits.length - 1;

                            updateEditsList();
                            renderCanvas();
                        };
                        img.src = event.target.result;
                    };
                    reader.readAsDataURL(file);
                }

                // Reset input
                editImageUpload.value = '';
            };

            // OK button - finalize the edit element
            okBtn.onclick = () => {
                // Remove any active transparent input
                const existingInput = document.querySelector('input[style*="opacity: 0"]');
                if (existingInput && existingInput.parentNode) {
                    existingInput.parentNode.removeChild(existingInput);
                }

                if (edits.length === 0) {
                    console.warn('No edits to create');
                    alert('Please create at least one edit before clicking OK.');
                    return;
                }

                // Create overlay canvas at final video dimensions (1080x1920 TikTok portrait)
                const overlayCanvas = document.createElement('canvas');
                overlayCanvas.width = 1080;
                overlayCanvas.height = 1920;
                const overlayCtx = overlayCanvas.getContext('2d');

                // Scale factor from editor canvas (200x356) to final video (1080x1920)
                const scaleX = 1080 / 200;  // 5.4x
                const scaleY = 1920 / 356;  // 5.393x (same aspect ratio!)

                // Render all edits to the overlay canvas at final video size
                edits.forEach((edit) => {
                    if (edit.type === 'text') {
                        const data = edit.data;
                        const scaledSize = data.size * scaleY;
                        overlayCtx.font = `${scaledSize}px ${data.fontFamily}`;
                        overlayCtx.textAlign = data.align || 'left';
                        overlayCtx.textBaseline = 'top';

                        // Calculate X position based on alignment and scale to final video size
                        let textX = data.x * scaleX;
                        if (data.align === 'center') {
                            textX = overlayCanvas.width / 2;
                        } else if (data.align === 'right') {
                            const margin = 10 * scaleX;
                            textX = overlayCanvas.width - margin;
                        } else if (!data.x) {
                            textX = 10 * scaleX; // Default left margin, scaled
                        }

                        const textY = data.y * scaleY;
                        const lineHeight = scaledSize * 1.2;

                        // Wrap text to handle multi-line rendering at full video resolution
                        const margin = 10 * scaleX;
                        const maxWidth = overlayCanvas.width - (margin * 2);

                        // Measure text at the scaled size for proper wrapping
                        const tempCanvas = document.createElement('canvas');
                        const tempCtx = tempCanvas.getContext('2d');
                        tempCtx.font = `${scaledSize}px ${data.fontFamily}`;

                        // Wrap text at full resolution
                        function wrapTextFullScale(text, maxWidth) {
                            const words = text.split(' ');
                            const lines = [];
                            let currentLine = '';

                            for (let i = 0; i < words.length; i++) {
                                const testLine = currentLine + (currentLine ? ' ' : '') + words[i];
                                const metrics = tempCtx.measureText(testLine);

                                if (metrics.width > maxWidth && currentLine) {
                                    lines.push(currentLine);
                                    currentLine = words[i];
                                } else {
                                    currentLine = testLine;
                                }
                            }
                            if (currentLine) {
                                lines.push(currentLine);
                            }
                            return lines;
                        }

                        // Resolve variables for preview playback
                        const resolvedText = resolveVariables(data.text, 'preview');
                        const lines = wrapTextFullScale(resolvedText, maxWidth);

                        // Render each line at final video scale
                        lines.forEach((line, lineIndex) => {
                            const lineY = textY + (lineIndex * lineHeight);

                            if (data.strokeWidth > 0) {
                                overlayCtx.strokeStyle = data.strokeColor;
                                overlayCtx.lineWidth = data.strokeWidth * scaleY;
                                overlayCtx.strokeText(line, textX, lineY);
                            }

                            overlayCtx.fillStyle = data.color;
                            overlayCtx.fillText(line, textX, lineY);
                        });
                    } else if (edit.type === 'image') {
                        const data = edit.data;
                        if (data.imageElement && data.imageElement.complete) {
                            overlayCtx.drawImage(
                                data.imageElement,
                                (data.x - data.width / 2) * scaleX,
                                (data.y - data.height / 2) * scaleY,
                                data.width * scaleX,
                                data.height * scaleY
                            );
                        }
                    }
                });

                // Convert to data URL and store in editElement (at final video size: 1080x1920)
                editElement.dataset.overlayUrl = overlayCanvas.toDataURL('image/png');

                // Store the edits data for later re-editing
                editElement.dataset.editsData = JSON.stringify(edits);

                // Finalize the edit element
                finalizeEditElement(editElement);

                // Close modal
                modal.classList.remove('open');
                modal.style.display = 'none';
                modal.style.transform = '';

                // Clear edits array for next time
                edits = [];
                selectedEditIndex = null;
            };

            // Cancel button - close modal without saving
            cancelBtn.onclick = () => {
                // Remove any active transparent input
                const existingInput = document.querySelector('input[style*="opacity: 0"]');
                if (existingInput && existingInput.parentNode) {
                    existingInput.parentNode.removeChild(existingInput);
                }
                
                // Close modal
                modal.classList.remove('open');
                modal.style.display = 'none';
                modal.style.transform = '';
            };

            // Add Enter key support to trigger OK button
            document.addEventListener('keydown', function handleEnterKey(e) {
                if (e.key === 'Enter' && modal.style.display === 'block') {
                    // Check if we're not in a text input that's editing existing text
                    const activeInput = document.querySelector('input[style*="opacity: 0"]');
                    if (!activeInput) {
                        e.preventDefault();
                        okBtn.click();
                    }
                }
            });

            // Auto-create first edit if opening for new element
            let shouldAutoFocusText = false;
            if (!editElement.dataset.editsData || edits.length === 0) {
                const newEdit = {
                    type: 'text',
                    startTime: 0,
                    endTime: 5,
                    data: {
                        text: 'New Text',
                        x: 50,
                        y: canvas.height / 2,
                        size: parseInt(editFontSize.value),
                        fontFamily: editFontFamily.value,
                        color: editFontColor.value,
                        strokeWidth: parseInt(editStrokeWidth.value),
                        strokeColor: editStrokeColor.value,
                        align: 'center'
                    }
                };

                edits.push(newEdit);
                selectedEditIndex = 0;

                // Update controls
                if (editTextContent) editTextContent.value = newEdit.data.text;

                updateEditsList();
                shouldAutoFocusText = true;
            } else if (edits.length > 0) {
                // Auto-select first edit when re-editing existing element
                selectedEditIndex = 0;
                const firstEdit = edits[0];
                if (firstEdit.type === 'text') {
                    if (editTextContent) editTextContent.value = firstEdit.data.text;
                    editFontFamily.value = firstEdit.data.fontFamily;
                    editFontSize.value = firstEdit.data.size;
                    editFontColor.value = firstEdit.data.color;
                    editStrokeWidth.value = firstEdit.data.strokeWidth;
                    editStrokeColor.value = firstEdit.data.strokeColor;

                    // Update alignment buttons
                    textAlignLeft.classList.toggle('active', firstEdit.data.align === 'left');
                    textAlignCenter.classList.toggle('active', firstEdit.data.align === 'center');
                    textAlignRight.classList.toggle('active', firstEdit.data.align === 'right');
                }
                updateEditsList();
                shouldAutoFocusText = true; // Also auto-focus when re-editing
            }

            // Initialize
            renderCanvas();

            // Auto-focus text input for newly created or re-edited element
            if (shouldAutoFocusText && edits.length > 0 && edits[0].type === 'text') {
                setTimeout(() => {
                    // Simulate double-click on canvas to open text input
                    const rect = canvas.getBoundingClientRect();
                    const firstEdit = edits[0].data;
                    const clickEvent = new MouseEvent('dblclick', {
                        clientX: rect.left + (firstEdit.x || 50),
                        clientY: rect.top + (firstEdit.y || canvas.height / 2),
                        bubbles: true
                    });
                    canvas.dispatchEvent(clickEvent);
                }, 100);
            }
        }

        // Show edit canvas editor
        function showEditCanvasEditor(editElement) {
            const content = editElement.querySelector('.edit-content');

            const editorHTML = `
                <div class="edit-canvas-editor">
                    <canvas id="editCanvas" width="200" height="100" style="background: rgba(0,0,0,0.3); border-radius: 8px; cursor: crosshair; border: 1px solid #333;"></canvas>
                    <div class="edit-canvas-controls">
                        <button class="btn btn-small add-text-btn">+ Add Text</button>
                    </div>
                    <div class="form-actions" style="margin-top: 12px;">
                        <button class="btn btn-secondary cancel-edit-btn">Cancel</button>
                        <button class="btn btn-primary ok-edit-btn">OK</button>
                    </div>
                </div>
            `;

            content.innerHTML = editorHTML;

            const canvas = document.getElementById('editCanvas');
            const ctx = canvas.getContext('2d');

            // Store text objects
            let textObjects = [];
            let selectedText = null;
            let isDragging = false;
            let dragOffset = { x: 0, y: 0 };

            // Load existing canvas state if re-editing
            if (editElement.dataset.canvasState) {
                try {
                    textObjects = JSON.parse(editElement.dataset.canvasState);
                } catch (e) {
                    console.error('Error loading canvas state:', e);
                }
            }

            // Render canvas
            function render() {
                // Clear canvas to transparent
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                // DO NOT fill with black - keep it transparent!

                textObjects.forEach((textObj, index) => {
                    ctx.font = `${textObj.size}px Arial`;
                    ctx.fillStyle = textObj.color;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'top';

                    // Draw text
                    ctx.fillText(textObj.text, textObj.x, textObj.y);

                    // Draw selection box if selected (only in editor, not in export)
                    if (selectedText === index) {
                        const metrics = ctx.measureText(textObj.text);
                        ctx.strokeStyle = '#0066ff';
                        ctx.lineWidth = 2;
                        ctx.strokeRect(textObj.x - 4, textObj.y - 4, metrics.width + 8, textObj.size + 8);
                    }
                });
            }

            render();

            // Add text button
            const addTextBtn = content.querySelector('.add-text-btn');
            addTextBtn.addEventListener('click', () => {
                const newText = {
                    text: 'Double-click to edit',
                    x: 50,
                    y: 50 + (textObjects.length * 40),
                    size: 24,
                    color: '#ffffff'
                };
                textObjects.push(newText);
                selectedText = textObjects.length - 1;
                render();
            });

            // Canvas mouse events
            canvas.addEventListener('mousedown', (e) => {
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                // Check if clicking on any text
                selectedText = null;
                for (let i = textObjects.length - 1; i >= 0; i--) {
                    const textObj = textObjects[i];
                    ctx.font = `${textObj.size}px Arial`;
                    const metrics = ctx.measureText(textObj.text);

                    if (x >= textObj.x && x <= textObj.x + metrics.width &&
                        y >= textObj.y && y <= textObj.y + textObj.size) {
                        selectedText = i;
                        isDragging = true;
                        dragOffset = { x: x - textObj.x, y: y - textObj.y };
                        break;
                    }
                }
                render();
            });

            canvas.addEventListener('mousemove', (e) => {
                if (isDragging && selectedText !== null) {
                    const rect = canvas.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;

                    textObjects[selectedText].x = x - dragOffset.x;
                    textObjects[selectedText].y = y - dragOffset.y;
                    render();
                }
            });

            canvas.addEventListener('mouseup', () => {
                isDragging = false;
            });

            // Double-click to edit text
            canvas.addEventListener('dblclick', (e) => {
                if (selectedText !== null) {
                    const newText = prompt('Edit text:', textObjects[selectedText].text);
                    if (newText !== null) {
                        textObjects[selectedText].text = newText;
                        render();
                    }
                }
            });

            // OK button - save canvas
            const okBtn = content.querySelector('.ok-edit-btn');
            okBtn.addEventListener('click', () => {
                // Save canvas state for re-editing
                editElement.dataset.canvasState = JSON.stringify(textObjects);

                // Deselect everything before export to avoid selection border in PNG
                selectedText = null;
                render();

                // Export canvas as transparent PNG
                canvas.toBlob((blob) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        // Use simple property name to avoid camelCase conversion issues
                        editElement.dataset.overlayUrl = reader.result;
                        finalizeEditElement(editElement);
                    };
                    reader.readAsDataURL(blob);
                }, 'image/png'); // Explicitly specify PNG format for transparency support
            });

            // Cancel button
            const cancelBtn = content.querySelector('.cancel-edit-btn');
            cancelBtn.addEventListener('click', () => {
                // Restore original add-edit-btn
                content.innerHTML = `
                    <div class="add-edit-btn">
                        <span class="icon">+</span>
                        <span class="label">Create Edit</span>
                    </div>
                `;

                const newAddEditBtn = content.querySelector('.add-edit-btn');
                newAddEditBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showEditCanvasEditor(editElement);
                });
            });
        }

        // Finalize edit element
        function finalizeEditElement(editElement) {
            const duration = parseInt(editElement.dataset.duration) || 5;
            const overlayUrl = editElement.dataset.overlayUrl;

            // Extract text and styling from edits data
            let displayText = '';
            let textStyle = {
                fontFamily: 'Arial',
                fontSize: 14,
                color: '#1d1d1f',
                strokeWidth: 0,
                strokeColor: '#000000'
            };

            if (editElement.dataset.editsData) {
                try {
                    const edits = JSON.parse(editElement.dataset.editsData);
                    const textEdits = edits.filter(e => e.type === 'text');
                    if (textEdits.length > 0) {
                        displayText = textEdits.map(e => e.data.text).join(' ');
                        // Use the first text edit's styling
                        const firstEdit = textEdits[0].data;
                        textStyle.fontFamily = firstEdit.fontFamily || 'Arial';
                        textStyle.fontSize = Math.min(firstEdit.size || 14, 20); // Cap at 20px for display
                        textStyle.color = firstEdit.color || '#1d1d1f';
                        textStyle.strokeWidth = firstEdit.strokeWidth || 0;
                        textStyle.strokeColor = firstEdit.strokeColor || '#000000';
                    }
                } catch (e) {
                    console.error('Error parsing edits data:', e);
                }
            }

            // Build text stroke style
            const strokeStyle = textStyle.strokeWidth > 0
                ? `-webkit-text-stroke: ${textStyle.strokeWidth}px ${textStyle.strokeColor};`
                : '';

            const content = editElement.querySelector('.edit-content');
            content.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: flex-start; width: 100%; height: 100%; padding: 0 8px; gap: 8px;">
                    <div style="flex: 1; display: flex; align-items: center; min-width: 0;">
                        <div style="font-family: ${textStyle.fontFamily}; font-size: ${textStyle.fontSize}px; color: ${textStyle.color}; ${strokeStyle} font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${displayText || 'Edit'}
                        </div>
                    </div>
                    <div style="margin-left: auto; display: flex; gap: 12px; align-items: center; flex-shrink: 0;">
                        <div class="edit-btn-inline" style="cursor: pointer; color: rgba(134, 134, 139, 0.7); display: flex; align-items: center; transition: color 0.2s;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                        </div>
                        <div class="delete-btn-inline" style="cursor: pointer; display: flex; align-items: center; justify-content: center; width: 18px; height: 18px;">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="rgba(134, 134, 139, 0.7)" stroke-width="1.5" style="transition: stroke 0.2s;">
                                <line x1="2" y1="2" x2="10" y2="10"/>
                                <line x1="10" y1="2" x2="2" y2="10"/>
                            </svg>
                        </div>
                    </div>
                </div>
            `;

            editElement.dataset.type = 'edit';
            editElement.dataset.finalized = 'true';

            // Add event listeners to inline buttons
            const editBtnInline = content.querySelector('.edit-btn-inline');
            if (editBtnInline) {
                editBtnInline.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showEditTextModal(e, editElement);
                });
                editBtnInline.addEventListener('mouseenter', () => {
                    editBtnInline.style.color = 'rgba(29, 29, 31, 0.9)';
                });
                editBtnInline.addEventListener('mouseleave', () => {
                    editBtnInline.style.color = 'rgba(134, 134, 139, 0.7)';
                });
            }

            const deleteBtnInline = content.querySelector('.delete-btn-inline');
            if (deleteBtnInline) {
                deleteBtnInline.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteEditElement(editElement);
                });
                deleteBtnInline.addEventListener('mouseenter', () => {
                    const svg = deleteBtnInline.querySelector('svg');
                    if (svg) svg.setAttribute('stroke', 'rgba(29, 29, 31, 0.9)');
                });
                deleteBtnInline.addEventListener('mouseleave', () => {
                    const svg = deleteBtnInline.querySelector('svg');
                    if (svg) svg.setAttribute('stroke', 'rgba(134, 134, 139, 0.7)');
                });
            }

            // Add resize handle if it doesn't exist
            let resizeHandle = editElement.querySelector('.resize-handle');
            if (!resizeHandle) {
                resizeHandle = document.createElement('div');
                resizeHandle.className = 'resize-handle';
                editElement.appendChild(resizeHandle);
            }
            setupEditResizeHandlers(editElement);

            // Setup drag handlers for edit element
            setupEditDragHandlers(editElement);

            // Check for overlaps and adjust positioning
            handleEditOverlaps();

            // Add next edit slot
            addNextEditSlot();
        }

        // Calculate total timeline duration in seconds
        function getTimelineDuration() {
            const elementsRow = document.getElementById('elementsRow');
            const finalizedElements = Array.from(elementsRow.querySelectorAll('.timeline-element[data-finalized="true"]'));

            let totalDuration = 0;
            finalizedElements.forEach(element => {
                const duration = parseInt(element.dataset.duration) || 0;
                totalDuration += duration;
            });

            return totalDuration;
        }

        // Calculate total timeline duration in pixels
        function getTimelineDurationInPixels() {
            return getTimelineDuration() * PIXEL_PER_SECOND;
        }

        // Reposition the empty edit slot to the right of all finalized edits
        function repositionEmptyEditSlot() {
            const editTrack = document.getElementById('editTrack');
            const emptySlot = editTrack.querySelector('.edit-element:not([data-finalized="true"])');

            if (!emptySlot) return;

            // Find the rightmost position of all finalized edit elements
            const finalizedEdits = editTrack.querySelectorAll('.edit-element[data-finalized="true"]');
            let maxRight = 0;

            if (finalizedEdits.length === 0) {
                // No finalized edits, place at the start
                maxRight = 0;
            } else {
                finalizedEdits.forEach(edit => {
                    const left = parseInt(edit.style.left) || 0;
                    const width = parseInt(edit.style.width) || 200;
                    const right = left + width;
                    if (right > maxRight) maxRight = right;
                });
                // Add gap after the last edit
                maxRight += 20;
            }

            // Always position at the right of all edits
            emptySlot.style.left = `${maxRight}px`;
            emptySlot.style.top = '0px';
        }

        // Handle overlapping edits by stacking them vertically
        function handleEditOverlaps() {
            const editTrack = document.getElementById('editTrack');
            const finalizedEdits = Array.from(editTrack.querySelectorAll('.edit-element[data-finalized="true"]'));

            // Sort edits by their left position for consistent ordering
            finalizedEdits.sort((a, b) => {
                const leftA = parseInt(a.style.left) || 0;
                const leftB = parseInt(b.style.left) || 0;
                return leftA - leftB;
            });

            // Reset all edits to default state first
            finalizedEdits.forEach(edit => {
                edit.style.top = '0px';
                edit.style.height = '';
                edit.style.marginBottom = '0px';
                const content = edit.querySelector('.edit-content');
                if (content) {
                    content.style.height = '100px';
                    content.style.minHeight = '100px';
                    content.style.maxHeight = '100px';
                    content.style.paddingTop = '';
                    content.style.paddingBottom = '';
                }
                // Reset resize handle
                const resizeHandle = edit.querySelector('.resize-handle');
                if (resizeHandle) {
                    resizeHandle.style.width = '';
                    resizeHandle.style.right = '';
                }
                // Reset blue resize handle height
                edit.style.removeProperty('--resize-handle-height');
            });

            // Build overlap groups
            const overlapGroups = [];

            finalizedEdits.forEach((edit, i) => {
                const left = parseInt(edit.style.left) || 0;
                const width = parseInt(edit.style.width) || 200;
                const right = left + width;

                // Find which group this edit belongs to
                let addedToGroup = false;
                for (let group of overlapGroups) {
                    // Check if this edit overlaps with any edit in the group
                    for (let otherEdit of group) {
                        const otherLeft = parseInt(otherEdit.style.left) || 0;
                        const otherWidth = parseInt(otherEdit.style.width) || 200;
                        const otherRight = otherLeft + otherWidth;

                        // Check if they overlap in time
                        if (left < otherRight && right > otherLeft) {
                            group.push(edit);
                            addedToGroup = true;
                            break;
                        }
                    }
                    if (addedToGroup) break;
                }

                // If not added to any group, create a new group
                if (!addedToGroup) {
                    overlapGroups.push([edit]);
                }
            });

            // Apply stacking to overlapping groups
            overlapGroups.forEach(group => {
                if (group.length === 2) {
                    // Two edits overlapping - make them half height and stack
                    group.forEach((edit, index) => {
                        const content = edit.querySelector('.edit-content');
                        if (content) {
                            content.style.height = '47px';
                            content.style.minHeight = '47px';
                            content.style.maxHeight = '47px';
                        }
                        // Position vertically with 3px gap
                        edit.style.top = `${index * 50}px`;
                        edit.style.marginBottom = (index === 0) ? '3px' : '0px';

                        // Make blue resize handle height match content
                        edit.style.setProperty('--resize-handle-height', '47px');
                    });
                } else if (group.length === 3) {
                    // Three edits overlapping - make them 1/3 height and stack
                    group.forEach((edit, index) => {
                        const content = edit.querySelector('.edit-content');
                        if (content) {
                            content.style.height = '31px';
                            content.style.minHeight = '31px';
                            content.style.maxHeight = '31px';
                        }
                        // Position vertically with 2px gaps
                        edit.style.top = `${index * 33}px`;
                        edit.style.marginBottom = (index < 2) ? '2px' : '0px';

                        // Make resize handle smaller
                        const resizeHandle = edit.querySelector('.resize-handle');
                        if (resizeHandle) {
                            resizeHandle.style.width = '14px';
                            resizeHandle.style.right = '-7px';
                        }

                        // Make blue resize handle height match content
                        edit.style.setProperty('--resize-handle-height', '31px');
                    });
                } else if (group.length === 4) {
                    // Four edits overlapping - make them smaller with visible gaps
                    group.forEach((edit, index) => {
                        const content = edit.querySelector('.edit-content');
                        if (content) {
                            content.style.height = '27px';
                            content.style.minHeight = '27px';
                            content.style.maxHeight = '27px';
                            content.style.paddingTop = '1px';
                            content.style.paddingBottom = '1px';
                        }
                        // Position vertically: 27px height + 2px padding top/bottom = 29px total per element
                        edit.style.top = `${index * 29}px`;
                        edit.style.marginBottom = '0px';
                        edit.style.marginTop = '0px';

                        // Make text and icons smaller for 4-stack
                        const textDiv = content.querySelector('div > div > div');
                        if (textDiv) textDiv.style.fontSize = '11px';

                        const editBtn = edit.querySelector('.edit-btn-inline svg');
                        const deleteBtn = edit.querySelector('.delete-btn-inline svg');
                        if (editBtn) editBtn.style.transform = 'scale(0.8)';
                        if (deleteBtn) deleteBtn.style.transform = 'scale(0.8)';

                        // Make resize handle smaller
                        const resizeHandle = edit.querySelector('.resize-handle');
                        if (resizeHandle) {
                            resizeHandle.style.width = '12px';
                            resizeHandle.style.right = '-6px';
                        }

                        // Make blue resize handle height match content
                        edit.style.setProperty('--resize-handle-height', '27px');
                    });
                } else {
                    // Single edit or 5+ (reset to default)
                    group.forEach(edit => {
                        edit.style.marginBottom = '0px';

                        // Reset resize handle to default
                        const resizeHandle = edit.querySelector('.resize-handle');
                        if (resizeHandle) {
                            resizeHandle.style.width = '';
                            resizeHandle.style.right = '';
                        }

                        // Reset blue resize handle height to default
                        edit.style.removeProperty('--resize-handle-height');
                    });
                }
            });
        }

        // Setup drag handlers for edit elements
        function setupEditDragHandlers(editElement) {
            let isDraggingEdit = false;
            let dragStartX = 0;
            let dragOffsetX = 0;
            let originalLeft = 0;

            editElement.addEventListener('mousedown', (e) => {
                // Don't drag if clicking on buttons or resize handle
                if (e.target.closest('.edit-btn') || e.target.closest('.delete-btn') ||
                    e.target.closest('.edit-btn-inline') || e.target.closest('.delete-btn-inline') ||
                    e.target.closest('.resize-handle') || !editElement.dataset.finalized) {
                    return;
                }

                isDraggingEdit = true;
                dragStartX = e.clientX;

                // Get current left position
                const currentLeft = parseInt(editElement.style.left) || 0;
                originalLeft = currentLeft;
                dragOffsetX = e.clientX - currentLeft;

                editElement.classList.add('dragging-edit');

                // Hide the empty edit slot while dragging
                const editTrack = document.getElementById('editTrack');
                const emptySlot = Array.from(editTrack.children).find(el => !el.dataset.finalized);
                if (emptySlot) {
                    emptySlot.style.display = 'none';
                }

                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDraggingEdit) return;

                const newLeft = e.clientX - dragOffsetX;

                // Snap to 40px grid (PIXEL_PER_SECOND)
                const snappedLeft = Math.round(newLeft / PIXEL_PER_SECOND) * PIXEL_PER_SECOND;

                // Ensure minimum of 0 (no upper limit - can drag anywhere)
                const boundedLeft = Math.max(0, snappedLeft);
                editElement.style.left = `${boundedLeft}px`;
            });

            document.addEventListener('mouseup', () => {
                if (!isDraggingEdit) return;

                isDraggingEdit = false;
                editElement.classList.remove('dragging-edit');

                // Check for overlaps and adjust positioning
                handleEditOverlaps();

                // Show the empty edit slot again and reposition it
                const editTrack = document.getElementById('editTrack');
                const emptySlot = editTrack.querySelector('.edit-element:not([data-finalized="true"])');
                if (emptySlot) {
                    emptySlot.style.display = 'flex';
                    repositionEmptyEditSlot();
                }
            });
        }

        // Finalize element
        function finalizeElement(elementDiv, type, elementId) {
            console.log(`[FINALIZE] Starting finalization for element ${elementId}, type=${type}`);

            // FIX ISSUE #1: Defensive check - ensure .element-content exists
            let contentDiv = elementDiv.querySelector('.element-content');
            if (!contentDiv) {
                console.warn(`[FINALIZE ISSUE #1] Missing .element-content div for ${elementId} - creating it now`);
                contentDiv = document.createElement('div');
                contentDiv.className = 'element-content';
                elementDiv.appendChild(contentDiv);
            } else {
                console.log(`[FINALIZE] .element-content exists for ${elementId}`);
            }

            const duration = parseInt(elementDiv.dataset.duration) || 5;

            let previewHTML = '';

            switch(type) {
                case 'video':
                    const videoFramesData = elementDiv.dataset.videoFrames;
                    const frameCount = Math.max(1, Math.ceil(duration / 5));
                    const videoMissing = elementDiv.dataset.mediaMissing === 'true';

                    if (videoMissing) {
                        // Show missing media indicator
                        previewHTML = `
                            <div class="element-preview" style="background: #ffebee;">
                                <div class="element-type-badge" style="background: #d32f2f;">${elementDiv.dataset.elementName || 'VIDEO'}</div>
                                <div class="duration-indicator">${duration}s</div>
                                <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #d32f2f; font-size: 12px;">
                                    ⚠️ Missing: ${elementDiv.dataset.videoFile || 'video.mp4'}
                                </div>
                            </div>
                        `;
                    } else if (videoFramesData) {
                        // Show extracted video frames
                        const frames = JSON.parse(videoFramesData);
                        const originalWidth = duration * PIXEL_PER_SECOND;
                        const frameWidth = (originalWidth - (frames.length - 1) * 4) / frames.length; // Account for gaps

                        previewHTML = `
                            <div class="element-preview">
                                <div class="element-type-badge">${elementDiv.dataset.elementName || 'VIDEO'}</div>
                                <div class="duration-indicator">${duration}s</div>
                                <div class="video-frames">
                                    ${frames.map(frameURL => `
                                        <div class="video-frame" style="width: ${frameWidth}px; min-width: ${frameWidth}px;">
                                            <img src="${frameURL}" />
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `;
                    } else {
                        // Show empty preview for pool-based videos
                        previewHTML = `
                            <div class="element-preview">
                                <div class="element-type-badge">${elementDiv.dataset.elementName || 'VIDEO'}</div>
                                <div class="duration-indicator">${duration}s</div>
                            </div>
                        `;
                    }
                    break;

                case 'image':
                    const imageData = elementDiv.dataset.imageData;
                    const imageFrameCount = Math.max(1, Math.ceil(duration / 5));
                    const imageMissing = elementDiv.dataset.mediaMissing === 'true';

                    if (imageMissing) {
                        // Show missing media indicator
                        previewHTML = `
                            <div class="element-preview" data-type="image" style="background: #ffebee;">
                                <div class="element-type-badge" style="background: #d32f2f;">${elementDiv.dataset.elementName || 'IMAGE'}</div>
                                <div class="duration-indicator">${duration}s</div>
                                <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #d32f2f; font-size: 12px;">
                                    ⚠️ Missing: ${elementDiv.dataset.imageFile || 'image.png'}
                                </div>
                            </div>
                        `;
                    } else if (imageData) {
                        // Each image frame is always exactly 5 seconds wide (200px)
                        const imageFrameWidth = 5 * PIXEL_PER_SECOND;

                        previewHTML = `
                            <div class="element-preview" data-type="image">
                                <div class="element-type-badge">${elementDiv.dataset.elementName || 'IMAGE'}</div>
                                <div class="duration-indicator">${duration}s</div>
                                <div class="video-frames">
                                    ${Array(imageFrameCount).fill().map(() => `
                                        <div class="video-frame" style="width: ${imageFrameWidth}px; min-width: ${imageFrameWidth}px;">
                                            <img src="${imageData}" />
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `;
                    } else {
                        previewHTML = `
                            <div class="element-preview" data-type="image">
                                <div class="element-type-badge">${elementDiv.dataset.elementName || 'IMAGE'}</div>
                                <div class="duration-indicator">${duration}s</div>
                            </div>
                        `;
                    }
                    break;

                case 'ai-video':
                    previewHTML = `
                        <div class="element-preview">
                            <div class="element-type-badge">${elementDiv.dataset.elementName || 'AI VIDEO'}</div>
                            <div class="duration-indicator">${duration}s</div>
                            <span class="placeholder-icon">✨</span>
                        </div>
                    `;
                    break;

                case 'ai-image':
                    previewHTML = `
                        <div class="element-preview">
                            <div class="element-type-badge">${elementDiv.dataset.elementName || 'AI IMAGE'}</div>
                            <div class="duration-indicator">${duration}s</div>
                            <span class="placeholder-icon">🎨</span>
                        </div>
                    `;
                    break;

                case 'pool':
                    // Pool preview - determine badge based on pool type
                    const poolType = elementDiv.dataset.poolType || 'video';
                    const poolBadge = poolType === 'video' ? 'VIDEO POOL' : 'IMAGE POOL';
                    previewHTML = `
                        <div class="element-preview">
                            <div class="element-type-badge">${elementDiv.dataset.elementName || poolBadge}</div>
                            <div class="duration-indicator">${duration}s</div>
                        </div>
                    `;
                    break;

                case 'ai-video':
                    // AI Video preview
                    const aiConfig = elementDiv.dataset.aiVideoConfig ? JSON.parse(elementDiv.dataset.aiVideoConfig) : {};
                    const modelBadge = aiConfig.model === 'sora-2-pro' ? 'PRO' : '';
                    previewHTML = `
                        <div class="element-preview">
                            <div class="element-type-badge">${elementDiv.dataset.elementName || '✨ AI VIDEO ' + modelBadge}</div>
                            <div class="duration-indicator">${duration}s</div>
                            <div style="padding: 12px; font-size: 11px; color: #86868b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                ${aiConfig.prompt || 'No prompt'}
                            </div>
                        </div>
                    `;
                    break;
            }

            // Safely set innerHTML (contentDiv verified to exist above)
            contentDiv.innerHTML = previewHTML;
            elementDiv.dataset.type = type;
            elementDiv.dataset.finalized = 'true';

            console.log(`[FINALIZE] Element ${elementId} finalized successfully: type=${type}, finalized=true`);

            // If there's a custom element name, remove uppercase transformation
            const badge = elementDiv.querySelector('.element-type-badge');
            if (badge && elementDiv.dataset.elementName) {
                badge.style.textTransform = 'none';
            }

            // Display pool thumbnails if a pool was selected
            if (elementDiv.dataset.poolData) {
                try {
                    const pool = JSON.parse(elementDiv.dataset.poolData);
                    displayPoolThumbnails(elementDiv, pool);
                } catch (err) {
                    console.error('Error parsing pool data:', err);
                }
            }

            // Add edit button - position it right after the badge
            const editBtn = document.createElement('div');
            editBtn.className = 'edit-btn';
            // Filled pencil icon pointing left (flipped horizontally)
            editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
            editBtn.addEventListener('click', () => editElement(elementDiv, type));
            elementDiv.appendChild(editBtn);
            
            // Position edit button right after badge on same horizontal line
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    positionEditButtonAfterBadge(elementDiv);
                });
            });

            // Add delete button
            const deleteBtn = document.createElement('div');
            deleteBtn.className = 'delete-btn';
            deleteBtn.addEventListener('click', () => deleteElement(elementDiv));
            elementDiv.appendChild(deleteBtn);

            // Add resize handle
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            elementDiv.appendChild(resizeHandle);
            setupResizeHandlers(elementDiv);

            // Setup drag-to-reorder
            setupDragToReorder(elementDiv);

            // Add next element
            addNextElementSlot();

            // Update ruler
            initializeTimelineRuler();

            // Update edit track bounds when timeline elements are added
            repositionEmptyEditSlot();

            // Trigger auto-save
            triggerAutoSave();
        }

        // Update video element preview with frame thumbnails (without changing finalized state)
        function updateVideoPreviewWithFrames(elementDiv) {
            if (elementDiv.dataset.type !== 'video') return;
            
            const contentDiv = elementDiv.querySelector('.element-content');
            if (!contentDiv) {
                console.warn('[UPDATE PREVIEW] No .element-content found');
                return;
            }

            const videoFramesData = elementDiv.dataset.videoFrames;
            const duration = parseInt(elementDiv.dataset.duration) || 5;
            
            let previewHTML = '';
            
            if (videoFramesData) {
                try {
                    const frames = JSON.parse(videoFramesData);
                    const originalWidth = duration * PIXEL_PER_SECOND;
                    const frameWidth = (originalWidth - (frames.length - 1) * 4) / frames.length; // Account for gaps
                    
                    previewHTML = `
                        <div class="element-preview">
                            <div class="element-type-badge">${elementDiv.dataset.elementName || 'VIDEO'}</div>
                            <div class="duration-indicator">${duration}s</div>
                            <div class="video-frames">
                                ${frames.map(frameURL => `
                                    <div class="video-frame" style="width: ${frameWidth}px; min-width: ${frameWidth}px;">
                                        <img src="${frameURL}" />
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                } catch (e) {
                    console.error('[UPDATE PREVIEW] Error parsing video frames:', e);
                    // Fall back to basic preview
                    previewHTML = `
                        <div class="element-preview">
                            <div class="element-type-badge">${elementDiv.dataset.elementName || 'VIDEO'}</div>
                            <div class="duration-indicator">${duration}s</div>
                        </div>
                    `;
                }
            } else {
                // No frames yet - show basic preview (this is the initial state before frames are extracted)
                previewHTML = `
                    <div class="element-preview">
                        <div class="element-type-badge">${elementDiv.dataset.elementName || 'VIDEO'}</div>
                        <div class="duration-indicator">${duration}s</div>
                    </div>
                `;
            }
            
            contentDiv.innerHTML = previewHTML;
            console.log(`[UPDATE PREVIEW] ✓ Updated video preview for ${elementDiv.dataset.elementId} with ${videoFramesData ? `${JSON.parse(videoFramesData).length} frames` : 'no frames'}`);
        }

        // Update element width based on duration
        function updateElementWidth(elementDiv) {
            const duration = parseInt(elementDiv.dataset.duration) || 5;
            const width = duration * PIXEL_PER_SECOND;
            elementDiv.style.width = `${width}px`;
        }

        // Add next element slot
        function addNextElementSlot() {
            const elementsRow = document.getElementById('elementsRow');

            // Check if there's already an empty slot
            const existingEmpty = Array.from(elementsRow.children).find(el => !el.dataset.finalized);
            if (existingEmpty) return;

            const newId = `element-${nextElementId++}`;
            const newElement = document.createElement('div');
            newElement.className = 'timeline-element';
            newElement.dataset.duration = '5';
            newElement.dataset.elementId = newId;

            newElement.innerHTML = `
                <div class="element-content">
                    <div class="add-element-btn">
                        <span class="icon">+</span>
                        <span class="label">Add Element</span>
                    </div>
                </div>
            `;

            elementsRow.appendChild(newElement);

            const addBtn = newElement.querySelector('.add-element-btn');
            addBtn.addEventListener('click', (e) => showDropdown(addBtn, e));
        }

        // Update element width (height stays fixed)
        function updateElementWidth(element) {
            const duration = parseInt(element.dataset.duration) || 5;
            const width = duration * PIXEL_PER_SECOND;
            element.style.width = `${width}px`;
            element.style.minWidth = `${width}px`;

            // Keep height fixed - don't let it grow with width
            const content = element.querySelector('.element-content');
            if (content) {
                content.style.minHeight = `${BASE_HEIGHT}px`;
                content.style.maxHeight = `${BASE_HEIGHT}px`;
            }
        }

        // Add next edit slot
        function addNextEditSlot() {
            const editTrack = document.getElementById('editTrack');

            // Check if there's already an empty slot
            const existingEmpty = editTrack.querySelector('.edit-element:not([data-finalized="true"])');
            if (existingEmpty) return;

            let nextEditId = 1;
            const allEdits = editTrack.querySelectorAll('.edit-element');
            if (allEdits.length > 0) {
                nextEditId = allEdits.length + 1;
            }

            const newId = `edit-${nextEditId}`;
            const newEdit = document.createElement('div');
            newEdit.className = 'edit-element';
            newEdit.dataset.duration = '5';
            newEdit.dataset.editId = newId;

            newEdit.innerHTML = `
                <div class="edit-content">
                    <div class="add-edit-btn">
                        <span class="icon">+</span>
                        <span class="label">Create Edit</span>
                    </div>
                </div>
            `;

            // Add resize handle to the new edit slot
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            newEdit.appendChild(resizeHandle);

            // Append to edit track
            editTrack.appendChild(newEdit);

            // Position using the repositioning function for consistency
            repositionEmptyEditSlot();

            // Setup resize handlers for the new edit element
            setupEditResizeHandlers(newEdit);

            const addBtn = newEdit.querySelector('.add-edit-btn');
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showEditTextModal(e, newEdit);
            });
        }

        // Delete edit element
        function deleteEditElement(editElement) {
            editElement.remove();
            // Check for overlaps after deletion
            handleEditOverlaps();
            addNextEditSlot();
            // Reposition the empty slot after deletion
            repositionEmptyEditSlot();
        }

        // Setup edit resize handlers
        function setupEditResizeHandlers(element) {
            const resizeHandle = element.querySelector('.resize-handle');
            if (!resizeHandle) return;

            resizeHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();

                isResizing = true;
                resizingElement = element;
                resizeStartX = e.clientX;
                resizeStartWidth = element.offsetWidth;

                document.body.style.cursor = 'ew-resize';

                document.addEventListener('mousemove', handleEditResize);
                document.addEventListener('mouseup', handleEditResizeEnd);
            });
        }

        // Handle edit resize
        function handleEditResize(e) {
            if (!isResizing || !resizingElement) return;

            const deltaX = e.clientX - resizeStartX;
            const newWidth = resizeStartWidth + deltaX;

            const newDuration = Math.round(newWidth / PIXEL_PER_SECOND);
            const elementType = resizingElement.dataset.type;

            // Helper function to show shake animation
            const showMaxDurationFeedback = () => {
                // DEFENSIVE: Check resizingElement still exists
                if (!resizingElement) return;
                
                const resizeHandle = resizingElement.querySelector('.resize-handle');
                if (resizeHandle && !resizeHandle.classList.contains('max-size')) {
                    resizeHandle.classList.add('max-size');

                    if (resizingElement && resizingElement.classList) {
                        resizingElement.classList.add('bounce');
                        setTimeout(() => {
                            if (resizingElement && resizingElement.classList) {
                                resizingElement.classList.remove('bounce');
                            }
                        }, 600);
                    }

                    setTimeout(() => {
                        if (resizeHandle && resizeHandle.classList) {
                            resizeHandle.classList.remove('max-size');
                        }
                    }, 1000);
                }
            };

            // Check AI Video max duration (12 seconds)
            if (elementType === 'ai-video') {
                if (newDuration > 12) {
                    showMaxDurationFeedback();
                    return;
                }
            }

            // Check video pool max duration (longest video in pool)
            if (elementType === 'pool' && resizingElement.dataset.poolType === 'video') {
                const poolData = resizingElement.dataset.poolData;
                if (poolData) {
                    try {
                        const pool = JSON.parse(poolData);
                        let maxVideoDuration = 1;
                        pool.files.forEach(file => {
                            if (file.duration && file.duration > maxVideoDuration) {
                                maxVideoDuration = file.duration;
                            }
                        });
                        const maxPoolDuration = Math.floor(maxVideoDuration);
                        if (newDuration > maxPoolDuration) {
                            showMaxDurationFeedback();
                            return;
                        }
                    } catch (err) {
                        console.error('Error validating pool during resize:', err);
                    }
                }
            }

            // Check specific uploaded video max duration
            const hasSpecificVideo = resizingElement.dataset.originalDuration && resizingElement.dataset.videoURL;

            if (hasSpecificVideo) {
                const maxDuration = parseInt(resizingElement.dataset.originalDuration);

                // Prevent resizing larger than original duration
                if (newDuration > maxDuration) {
                    showMaxDurationFeedback();
                    return;
                }
            }

            // Check global MAX_DURATION (60 seconds)
            if (newDuration > MAX_DURATION) {
                showMaxDurationFeedback();
                return;
            }

            // Constrain duration to minimum 1 second
            const finalDuration = Math.max(1, newDuration);

            resizingElement.dataset.duration = finalDuration;

            const width = finalDuration * PIXEL_PER_SECOND;
            resizingElement.style.width = `${width}px`;
            resizingElement.style.minWidth = `${width}px`;

            // Update empty slot position during resize
            repositionEmptyEditSlot();
        }

        // Handle edit resize end
        function handleEditResizeEnd() {
            isResizing = false;
            resizingElement = null;
            document.body.style.cursor = '';

            document.removeEventListener('mousemove', handleEditResize);
            document.removeEventListener('mouseup', handleEditResizeEnd);

            // Check for overlaps and adjust positioning
            handleEditOverlaps();

            // Reposition the empty slot after resize
            repositionEmptyEditSlot();
        }

        // Setup resize handlers
        function setupResizeHandlers(element) {
            const resizeHandle = element.querySelector('.resize-handle');
            if (!resizeHandle) return;

            resizeHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();

                isResizing = true;
                resizingElement = element;
                resizeStartX = e.clientX;
                resizeStartWidth = element.offsetWidth;

                document.body.style.cursor = 'ew-resize';

                document.addEventListener('mousemove', handleResize);
                document.addEventListener('mouseup', handleResizeEnd);
            });
        }

        // Handle resize
        function handleResize(e) {
            if (!isResizing || !resizingElement) return;

            const deltaX = e.clientX - resizeStartX;
            const newWidth = resizeStartWidth + deltaX;

            const newDuration = Math.round(newWidth / PIXEL_PER_SECOND);
            const elementType = resizingElement.dataset.type;

            // Helper function to show shake animation
            const showMaxDurationFeedback = () => {
                // DEFENSIVE: Check resizingElement still exists
                if (!resizingElement) return;
                
                const resizeHandle = resizingElement.querySelector('.resize-handle');
                if (resizeHandle && !resizeHandle.classList.contains('max-size')) {
                    resizeHandle.classList.add('max-size');

                    if (resizingElement && resizingElement.classList) {
                        resizingElement.classList.add('bounce');
                        setTimeout(() => {
                            if (resizingElement && resizingElement.classList) {
                                resizingElement.classList.remove('bounce');
                            }
                        }, 600);
                    }

                    setTimeout(() => {
                        if (resizeHandle && resizeHandle.classList) {
                            resizeHandle.classList.remove('max-size');
                        }
                    }, 1000);
                }
            };

            // Check AI Video max duration (12 seconds)
            if (elementType === 'ai-video') {
                if (newDuration > 12) {
                    showMaxDurationFeedback();
                    return;
                }
            }

            // Check video pool max duration (longest video in pool)
            if (elementType === 'pool' && resizingElement.dataset.poolType === 'video') {
                const poolData = resizingElement.dataset.poolData;
                if (poolData) {
                    try {
                        const pool = JSON.parse(poolData);
                        let maxVideoDuration = 1;
                        pool.files.forEach(file => {
                            if (file.duration && file.duration > maxVideoDuration) {
                                maxVideoDuration = file.duration;
                            }
                        });
                        const maxPoolDuration = Math.floor(maxVideoDuration);
                        if (newDuration > maxPoolDuration) {
                            showMaxDurationFeedback();
                            return;
                        }
                    } catch (err) {
                        console.error('Error validating pool during resize:', err);
                    }
                }
            }

            // Check specific uploaded video max duration
            const hasSpecificVideo = resizingElement.dataset.originalDuration && resizingElement.dataset.videoURL;

            if (hasSpecificVideo) {
                const maxDuration = parseInt(resizingElement.dataset.originalDuration);

                // Prevent resizing larger than original duration
                if (newDuration > maxDuration) {
                    showMaxDurationFeedback();
                    return; // Don't resize
                }
            }

            // Check global MAX_DURATION (60 seconds)
            if (newDuration > MAX_DURATION) {
                showMaxDurationFeedback();
                return;
            }

            // Allow resizing down to minimum
            const finalDuration = Math.max(1, newDuration);
            resizingElement.dataset.duration = finalDuration;
            updateElementWidth(resizingElement);

            const durationIndicator = resizingElement.querySelector('.duration-indicator');
            if (durationIndicator) {
                durationIndicator.textContent = `${finalDuration}s`;
            }

            // Update pool thumbnail overlays if a pool is selected
            if (resizingElement.dataset.poolData) {
                try {
                    const pool = JSON.parse(resizingElement.dataset.poolData);
                    updatePoolThumbnailOverlays(resizingElement, pool, finalDuration);
                } catch (err) {
                    console.error('Error updating pool thumbnail overlays during resize:', err);
                }
            }

            // Update frames display - keep frames at original size for clipping effect
            if (resizingElement.dataset.type === 'video') {
                const videoFramesData = resizingElement.dataset.videoFrames;
                if (videoFramesData) {
                    const allFrames = JSON.parse(videoFramesData);
                    const originalDuration = parseInt(resizingElement.dataset.originalDuration);
                    const originalWidth = originalDuration * PIXEL_PER_SECOND;

                    // Calculate frame width based on ORIGINAL duration, not current
                    const frameWidth = (originalWidth - (allFrames.length - 1) * 4) / allFrames.length; // Account for gaps

                    const videoFramesContainer = resizingElement.querySelector('.video-frames');
                    if (videoFramesContainer) {
                        // Show ALL frames at their original size - overflow will clip them
                        videoFramesContainer.innerHTML = allFrames.map(frameURL => `
                            <div class="video-frame" style="width: ${frameWidth}px; min-width: ${frameWidth}px;">
                                <img src="${frameURL}" />
                            </div>
                        `).join('');
                    }
                }
            } else if (resizingElement.dataset.type === 'image') {
                const imageData = resizingElement.dataset.imageData;
                if (imageData) {
                    // Calculate how many 5-second segments would fit in the current duration
                    // But always show frames at their fixed size (based on 5 seconds each)
                    const frameWidth = 5 * PIXEL_PER_SECOND; // Each frame is always 5 seconds wide
                    const maxPossibleFrames = Math.ceil(finalDuration / 5);

                    const imageFramesContainer = resizingElement.querySelector('.video-frames');
                    if (imageFramesContainer) {
                        // Show frames at fixed size - overflow will clip the rightmost ones
                        imageFramesContainer.innerHTML = Array(maxPossibleFrames).fill().map(() => `
                            <div class="video-frame" style="width: ${frameWidth}px; min-width: ${frameWidth}px;">
                                <img src="${imageData}" />
                            </div>
                        `).join('');
                    }
                }
            }

            initializeTimelineRuler();
        }

        // Handle resize end
        function handleResizeEnd() {
            isResizing = false;
            resizingElement = null;
            document.body.style.cursor = '';

            document.removeEventListener('mousemove', handleResize);
            document.removeEventListener('mouseup', handleResizeEnd);

            // Update edit track bounds when timeline elements are resized
            repositionEmptyEditSlot();

            // Trigger auto-save
            triggerAutoSave();
        }

        // ===== DRAG-TO-REORDER FUNCTIONALITY =====

        function setupDragToReorder(element) {
            // Only enable drag for finalized elements
            if (element.dataset.finalized !== 'true') return;

            element.addEventListener('mousedown', (e) => {
                // Don't drag if clicking on resize handle, buttons, dropdowns, or form elements
                if (e.target.closest('.resize-handle') ||
                    e.target.closest('.edit-btn') ||
                    e.target.closest('.delete-btn') ||
                    e.target.closest('.dropdown-trigger') ||
                    e.target.closest('.custom-dropdown') ||
                    e.target.closest('.element-form') ||  // Form container
                    e.target.closest('textarea') ||        // Textareas (prompt fields)
                    e.target.closest('input') ||           // Input fields
                    e.target.closest('select') ||          // Select dropdowns
                    e.target.closest('button') ||          // Buttons (OK, Cancel, etc.)
                    e.target.closest('.form-group') ||     // Form groups
                    e.target.closest('.upload-btn') ||     // Upload buttons
                    e.target.closest('.ai-video-prompt') || // AI video prompt field
                    e.target.closest('.ai-image-prompt') ||  // AI image prompt field
                    isResizing) {
                    return;
                }

                e.preventDefault();

                dragStartX = e.clientX;
                dragStartY = e.clientY;

                // Wait for slight movement before starting drag (prevents accidental drags)
                const startDragHandler = (e) => {
                    const deltaX = Math.abs(e.clientX - dragStartX);
                    const deltaY = Math.abs(e.clientY - dragStartY);

                    if (deltaX > 5 || deltaY > 5) {
                        document.removeEventListener('mousemove', startDragHandler);
                        document.removeEventListener('mouseup', cancelDrag);
                        startDragging(element, e);
                    }
                };

                const cancelDrag = () => {
                    document.removeEventListener('mousemove', startDragHandler);
                    document.removeEventListener('mouseup', cancelDrag);
                };

                document.addEventListener('mousemove', startDragHandler);
                document.addEventListener('mouseup', cancelDrag);
            });
        }

        function startDragging(element, e) {
            isDraggingElement = true;
            draggingElement = element;

            const rect = element.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;

            // Create placeholder
            dragPlaceholder = element.cloneNode(true);
            dragPlaceholder.classList.add('drag-placeholder');
            dragPlaceholder.classList.remove('dragging');
            element.parentNode.insertBefore(dragPlaceholder, element);

            // Make element follow cursor
            element.classList.add('dragging');
            element.style.left = `${rect.left}px`;
            element.style.top = `${rect.top}px`;
            element.style.width = `${rect.width}px`;

            document.body.style.cursor = 'grabbing';
            document.addEventListener('mousemove', handleDragging);
            document.addEventListener('mouseup', handleDragEnd);
        }

        function handleDragging(e) {
            if (!isDraggingElement || !draggingElement) return;

            // Move element with cursor
            draggingElement.style.left = `${e.clientX - dragOffsetX}px`;
            draggingElement.style.top = `${e.clientY - 20}px`;

            // Auto-scroll when near edges
            const edgeThreshold = 100; // pixels from edge to trigger scroll
            const maxScrollSpeed = 20; // max pixels per frame
            const viewportWidth = window.innerWidth;

            // Calculate distance from viewport edges
            const distanceFromLeft = e.clientX;
            const distanceFromRight = viewportWidth - e.clientX;

            // Determine scroll speed and direction
            if (distanceFromLeft < edgeThreshold && distanceFromLeft > 0) {
                // Near left edge - scroll left
                const intensity = 1 - (distanceFromLeft / edgeThreshold);
                autoScrollSpeed = -intensity * maxScrollSpeed;
                startAutoScroll();
            } else if (distanceFromRight < edgeThreshold && distanceFromRight > 0) {
                // Near right edge - scroll right
                const intensity = 1 - (distanceFromRight / edgeThreshold);
                autoScrollSpeed = intensity * maxScrollSpeed;
                startAutoScroll();
            } else {
                // Not near edges - stop scrolling
                stopAutoScroll();
            }

            const elementsRow = document.getElementById('elementsRow');

            const allElements = Array.from(elementsRow.querySelectorAll('.timeline-element[data-finalized="true"]'))
                .filter(el => el !== draggingElement && !el.classList.contains('drag-placeholder'));

            // Clear all indicators
            allElements.forEach(el => {
                el.classList.remove('drag-over-left', 'drag-over-right');
            });

            // Find closest element and determine drop position
            let closestElement = null;
            let closestDistance = Infinity;
            let dropSide = 'right';

            allElements.forEach(el => {
                const rect = el.getBoundingClientRect();
                const elementCenterX = rect.left + rect.width / 2;
                const distance = Math.abs(e.clientX - elementCenterX);

                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestElement = el;
                    dropSide = e.clientX < elementCenterX ? 'left' : 'right';
                }
            });

            // Show indicator
            if (closestElement) {
                if (dropSide === 'left') {
                    closestElement.classList.add('drag-over-left');
                } else {
                    closestElement.classList.add('drag-over-right');
                }
            }
        }

        function startAutoScroll() {
            if (autoScrollInterval) return; // Already scrolling

            autoScrollInterval = setInterval(() => {
                if (!isDraggingElement || autoScrollSpeed === 0) {
                    stopAutoScroll();
                    return;
                }

                // Scroll the window horizontally
                window.scrollBy(autoScrollSpeed, 0);
            }, 16); // ~60fps
        }

        function stopAutoScroll() {
            if (autoScrollInterval) {
                clearInterval(autoScrollInterval);
                autoScrollInterval = null;
                autoScrollSpeed = 0;
            }
        }

        function handleDragEnd(e) {
            if (!isDraggingElement || !draggingElement) return;

            const elementsRow = document.getElementById('elementsRow');
            const allElements = Array.from(elementsRow.querySelectorAll('.timeline-element[data-finalized="true"]'))
                .filter(el => el !== draggingElement && !el.classList.contains('drag-placeholder'));

            // Find drop target
            let targetElement = null;
            let dropSide = 'right';

            allElements.forEach(el => {
                if (el.classList.contains('drag-over-left')) {
                    targetElement = el;
                    dropSide = 'left';
                } else if (el.classList.contains('drag-over-right')) {
                    targetElement = el;
                    dropSide = 'right';
                }
                el.classList.remove('drag-over-left', 'drag-over-right');
            });

            // Remove dragging styles
            draggingElement.classList.remove('dragging');
            draggingElement.style.position = '';
            draggingElement.style.left = '';
            draggingElement.style.top = '';
            draggingElement.style.width = '';

            // Insert at new position
            if (targetElement) {
                if (dropSide === 'left') {
                    elementsRow.insertBefore(draggingElement, targetElement);
                } else {
                    if (targetElement.nextSibling) {
                        elementsRow.insertBefore(draggingElement, targetElement.nextSibling);
                    } else {
                        elementsRow.appendChild(draggingElement);
                    }
                }
            } else {
                // No target, put it back at placeholder position
                if (dragPlaceholder && dragPlaceholder.parentNode) {
                    elementsRow.insertBefore(draggingElement, dragPlaceholder);
                }
            }

            // Remove placeholder
            if (dragPlaceholder && dragPlaceholder.parentNode) {
                dragPlaceholder.remove();
            }

            // Stop auto-scroll
            stopAutoScroll();

            // Cleanup
            isDraggingElement = false;
            draggingElement = null;
            dragPlaceholder = null;
            document.body.style.cursor = '';

            document.removeEventListener('mousemove', handleDragging);
            document.removeEventListener('mouseup', handleDragEnd);

            // Update timeline ruler
            initializeTimelineRuler();

            // Update edit track bounds when timeline elements are reordered
            // (reordering doesn't change duration, but we call it for consistency)
            repositionEmptyEditSlot();

            // Trigger auto-save
            triggerAutoSave();
        }

        // ===== END DRAG-TO-REORDER =====

        // Edit element
        function editElement(elementDiv, type) {
            // Remove finalized state
            elementDiv.dataset.finalized = 'false';

            // Remove edit and delete buttons
            const editBtn = elementDiv.querySelector('.edit-btn');
            const deleteBtn = elementDiv.querySelector('.delete-btn');
            const resizeHandle = elementDiv.querySelector('.resize-handle');

            if (editBtn) editBtn.remove();
            if (deleteBtn) deleteBtn.remove();
            if (resizeHandle) resizeHandle.remove();

            // Show the form again
            const elementId = elementDiv.dataset.elementId;
            
            // If it's a pool element, use the poolType to determine which form to show
            if (type === 'pool' && elementDiv.dataset.poolType) {
                const poolType = elementDiv.dataset.poolType; // 'video' or 'image'
                showElementForm(elementDiv, poolType, elementId);
            } else {
                showElementForm(elementDiv, type, elementId);
            }
        }

        // Delete element
        function deleteElement(elementDiv) {
            const track = document.getElementById('timelineTrack');

            // Store element info for undo
            const elementData = {
                element: elementDiv.cloneNode(true),
                index: Array.from(track.children).indexOf(elementDiv)
            };
            deletedElements.push(elementData);

            // Remove element
            elementDiv.remove();

            // Update ruler
            initializeTimelineRuler();

            // Update edit track bounds when timeline elements are deleted
            repositionEmptyEditSlot();

            // Show toast notification
            showToast();

            // Trigger auto-save
            triggerAutoSave();
        }

        // Undo delete
        function undoDelete() {
            if (deletedElements.length === 0) return;

            const track = document.getElementById('timelineTrack');
            const lastDeleted = deletedElements.pop();

            // Reinsert at original position
            const allElements = Array.from(track.children);
            if (lastDeleted.index >= allElements.length) {
                track.appendChild(lastDeleted.element);
            } else {
                track.insertBefore(lastDeleted.element, allElements[lastDeleted.index]);
            }

            // Reattach event listeners
            const editBtn = lastDeleted.element.querySelector('.edit-btn');
            if (editBtn) {
                const type = lastDeleted.element.dataset.type;
                editBtn.addEventListener('click', () => editElement(lastDeleted.element, type));
            }

            const deleteBtn = lastDeleted.element.querySelector('.delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => deleteElement(lastDeleted.element));
            }

            const resizeHandle = lastDeleted.element.querySelector('.resize-handle');
            if (resizeHandle) {
                setupResizeHandlers(lastDeleted.element);
            }

            // Reposition edit button after restoring
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    positionEditButtonAfterBadge(lastDeleted.element);
                });
            });

            // Update ruler
            initializeTimelineRuler();

            // Hide toast
            if (currentToast) {
                hideToast(currentToast);
            }
        }

        // Show toast notification
        function showToast() {
            // Remove existing toast if any
            if (currentToast) {
                hideToast(currentToast);
            }

            const toast = document.createElement('div');
            toast.className = 'toast-notification';
            toast.innerHTML = `
                <span>Element deleted.</span>
                <button class="toast-undo-btn">Undo</button>
            `;

            document.body.appendChild(toast);
            currentToast = toast;

            // Undo button click
            const undoBtn = toast.querySelector('.toast-undo-btn');
            undoBtn.addEventListener('click', undoDelete);

            // Auto-hide after 5 seconds
            setTimeout(() => {
                if (currentToast === toast) {
                    hideToast(toast);
                }
            }, 5000);
        }

        // Hide toast notification
        function hideToast(toast) {
            toast.classList.add('hiding');
            setTimeout(() => {
                toast.remove();
                if (currentToast === toast) {
                    currentToast = null;
                }
            }, 300);
        }

        // ===== PREVIEW MODE FUNCTIONS =====

        // Prepare elements for preview
        async function preparePreviewElements() {
            const elementsRow = document.getElementById('elementsRow');
            const editTrack = document.getElementById('editTrack');

            // First, see ALL children of the elements row
            console.log('=== COLLECTING ELEMENTS ===');
            console.log('Elements row children count:', elementsRow.children.length);
            console.log('Elements row direct children:', Array.from(elementsRow.children).map((el, i) => {
                const rect = el.getBoundingClientRect();
                return `${i}: class=${el.className}, id=${el.dataset.elementId || 'no-id'}, left=${Math.round(rect.left)}`;
            }));

            // Collect timeline elements (videos/images - the base layer)
            const allTimelineElements = Array.from(elementsRow.querySelectorAll('.timeline-element'));
            console.log('Total .timeline-element on track:', allTimelineElements.length);

            // Filter out the initial button ONLY if it hasn't been configured
            const allElements = allTimelineElements.filter(el => {
                // Keep all regular elements
                if (el.dataset.elementId !== 'initial') return true;

                // For initial timeline element, only include if it has been configured with content
                const hasContent = el.dataset.finalized === 'true' &&
                                  el.dataset.type &&
                                  el.dataset.type !== 'none';

                console.log('Initial timeline element check:', {
                    elementId: el.dataset.elementId,
                    finalized: el.dataset.finalized,
                    type: el.dataset.type,
                    including: hasContent
                });

                return hasContent;
            });

            console.log('After filtering initial:', allElements.length, 'elements');
            console.log('DOM order (before sort):', allElements.map((el, i) => {
                const rect = el.getBoundingClientRect();
                return `${i}: id=${el.dataset.elementId}, type=${el.dataset.type || 'none'}, left=${Math.round(rect.left)}`;
            }));

            // Sort elements by their visual position (left to right)
            allElements.sort((a, b) => {
                const rectA = a.getBoundingClientRect();
                const rectB = b.getBoundingClientRect();
                return rectA.left - rectB.left;
            });

            console.log('Visual order (after sort):', allElements.map((el, i) => {
                const rect = el.getBoundingClientRect();
                return `${i}: id=${el.dataset.elementId}, type=${el.dataset.type || 'none'}, left=${Math.round(rect.left)}`;
            }));

            previewElements = [];

            for (const elementDiv of allElements) {
                const duration = parseInt(elementDiv.dataset.duration) || 5;
                const type = elementDiv.dataset.type;

                console.log('=== PROCESSING ELEMENT ===');
                console.log('Element ID:', elementDiv.dataset.elementId);
                console.log('Type:', type || 'unconfigured');
                console.log('Duration:', duration);
                console.log('Finalized:', elementDiv.dataset.finalized);
                console.log('Has poolData:', !!elementDiv.dataset.poolData);
                console.log('Has videoURL:', !!elementDiv.dataset.videoURL);
                console.log('Has imageData:', !!elementDiv.dataset.imageData);
                if (elementDiv.dataset.poolData) {
                    try {
                        const pool = JSON.parse(elementDiv.dataset.poolData);
                        console.log('Pool name:', pool.name, 'Files:', pool.files?.length);
                    } catch(e) {
                        console.error('Failed to parse poolData');
                    }
                }

                const element = {
                    duration: duration,
                    type: type || 'unconfigured',
                    element: elementDiv
                };

                // Prepare media based on type
                if (type === 'video') {
                    console.log('Processing video element, checking for pool data...');
                    // Check if this is from a pool
                    const poolData = elementDiv.dataset.poolData;
                    console.log('Pool data exists:', !!poolData);

                    if (poolData) {
                        try {
                            const pool = JSON.parse(poolData);
                            console.log('Parsed pool:', pool.name, 'files:', pool.files?.length);

                            if (pool.files && pool.files.length > 0) {
                                // Filter videos based on duration requirements
                                const acceptableVideos = pool.files.filter(file => {
                                    if (!file.duration) return true; // Include if duration unknown

                                    // Exclude videos shorter than element duration (unless looped)
                                    if (file.duration < duration && !file.loop) {
                                        console.log(`Excluding video ${file.name}: too short (${file.duration}s < ${duration}s) and not looped`);
                                        return false;
                                    }

                                    return true;
                                });

                                console.log(`Filtered videos: ${acceptableVideos.length}/${pool.files.length} acceptable`);

                                if (acceptableVideos.length > 0) {
                                    // Pick random video from acceptable videos
                                    const randomIndex = Math.floor(Math.random() * acceptableVideos.length);
                                    const selectedFile = acceptableVideos[randomIndex];

                                    element.mediaUrl = selectedFile.data; // Use 'data' property which contains the base64 URL
                                    element.mediaType = 'video';

                                    // Always start from the beginning, play up to the element duration
                                    element.videoStartTime = 0;
                                    console.log(`Playing from start: 0s to ${duration}s of ${selectedFile.duration || 'unknown'}s video`);

                                    // Mark if video should loop
                                    element.shouldLoop = selectedFile.loop || false;

                                    console.log('Selected random video from pool:', selectedFile.name, 'Duration:', selectedFile.duration, 'Loop:', element.shouldLoop);
                                } else {
                                    console.warn('No acceptable videos in pool for this duration!');
                                    element.mediaType = 'placeholder';
                                    element.placeholderText = 'No Acceptable Videos';
                                    element.placeholderIcon = '🎬';
                                }
                            } else {
                                console.warn('Pool has no files!');
                            }
                        } catch (err) {
                            console.error('Error parsing video pool data:', err);
                        }
                    } else {
                        // Direct upload
                        const videoURL = elementDiv.dataset.videoURL;
                        console.log('Direct upload, videoURL:', !!videoURL);
                        if (videoURL) {
                            element.mediaUrl = videoURL;
                            element.mediaType = 'video';
                            element.videoStartTime = 0;
                        }
                    }

                    // If no media was loaded, show placeholder
                    if (!element.mediaUrl) {
                        console.warn('No video media found for element');
                        element.mediaType = 'placeholder';
                        element.placeholderText = 'Video Not Loaded';
                        element.placeholderIcon = '🎬';
                    }
                } else if (type === 'image') {
                    console.log('Processing image element, checking for pool data...');
                    // Check if this is from a pool
                    const poolData = elementDiv.dataset.poolData;
                    console.log('Pool data exists:', !!poolData);

                    if (poolData) {
                        try {
                            const pool = JSON.parse(poolData);
                            console.log('Parsed pool:', pool.name, 'files:', pool.files?.length);

                            if (pool.files && pool.files.length > 0) {
                                // Pick random image from pool
                                const randomIndex = Math.floor(Math.random() * pool.files.length);
                                const selectedFile = pool.files[randomIndex];
                                element.mediaUrl = selectedFile.data; // Use 'data' property which contains the base64 URL
                                element.mediaType = 'image';
                                console.log('Selected random image from pool:', selectedFile.name);
                            } else {
                                console.warn('Pool has no files!');
                            }
                        } catch (err) {
                            console.error('Error parsing image pool data:', err);
                        }
                    } else {
                        // Direct upload
                        const imageData = elementDiv.dataset.imageData;
                        console.log('Direct upload, imageData:', !!imageData);
                        if (imageData) {
                            element.mediaUrl = imageData;
                            element.mediaType = 'image';
                        }
                    }

                    // If no media was loaded, show placeholder
                    if (!element.mediaUrl) {
                        console.warn('No image media found for element');
                        element.mediaType = 'placeholder';
                        element.placeholderText = 'Image Not Loaded';
                        element.placeholderIcon = '🖼️';
                    }
                } else if (type === 'ai-video') {
                    element.mediaType = 'placeholder';
                    element.placeholderText = 'AI Video';
                    element.placeholderIcon = '✨';
                } else if (type === 'ai-image') {
                    element.mediaType = 'placeholder';
                    element.placeholderText = 'AI Image';
                    element.placeholderIcon = '🎨';
                } else if (type === 'pool') {
                    // Handle pool elements - determine if it's video or image pool
                    const poolType = elementDiv.dataset.poolType || 'video';
                    const poolData = elementDiv.dataset.poolData;

                    console.log('Processing pool element, poolType:', poolType);

                    if (poolData) {
                        try {
                            const pool = JSON.parse(poolData);
                            console.log('Pool:', pool.name, 'Files:', pool.files?.length);

                            if (pool.files && pool.files.length > 0) {
                                if (poolType === 'video') {
                                    // Same logic as video pool handling
                                    const acceptableVideos = pool.files.filter(file => {
                                        if (!file.duration) return true;
                                        if (file.duration < duration && !file.loop) return false;
                                        return true;
                                    });

                                    if (acceptableVideos.length > 0) {
                                        const randomIndex = Math.floor(Math.random() * acceptableVideos.length);
                                        const selectedFile = acceptableVideos[randomIndex];

                                        element.mediaUrl = selectedFile.data;
                                        element.mediaType = 'video';

                                        // Always start from the beginning, play up to the element duration
                                        element.videoStartTime = 0;

                                        element.shouldLoop = selectedFile.loop || false;
                                    }
                                } else if (poolType === 'image') {
                                    // Random image from pool
                                    const randomIndex = Math.floor(Math.random() * pool.files.length);
                                    const selectedFile = pool.files[randomIndex];

                                    element.mediaUrl = selectedFile.data;
                                    element.mediaType = 'image';
                                }
                            }
                        } catch (err) {
                            console.error('Error parsing pool data in preview:', err);
                        }
                    }

                    // Fallback if no media loaded
                    if (!element.mediaUrl) {
                        element.mediaType = 'placeholder';
                        element.placeholderText = poolType === 'video' ? 'Video Pool' : 'Image Pool';
                        element.placeholderIcon = poolType === 'video' ? '🎬' : '🖼️';
                    }
                } else {
                    // Unconfigured or unknown element type - skip it
                    console.log('Skipping unconfigured element');
                    continue; // Don't add unconfigured elements to preview
                }

                console.log('Prepared element:', element.type, 'mediaType:', element.mediaType, 'hasURL:', !!element.mediaUrl);
                previewElements.push(element);
            }

            console.log('Total preview elements prepared:', previewElements.length);
            return previewElements;
        }

        // Start preview mode
        async function startPreview() {
            if (isPreviewMode) return;

            // Push history state BEFORE starting preview to prevent back navigation
            history.pushState({ preventBack: true, previewMode: true, timestamp: Date.now() }, '');
            hasPushedState = true;
            isHorizontalScrolling = true; // Set flag to prevent any navigation

            // Prepare elements
            await preparePreviewElements();

            if (previewElements.length === 0) {
                alert('Add some elements to the timeline first!');
                return;
            }

            // Scroll to beginning and ensure timeline is reset
            window.scrollTo({ left: 0, behavior: 'smooth' });

            // Preserve zoom but reset playback position
            const track = document.getElementById('timelineTrack');
            const ruler = document.getElementById('timelineRuler');

            // Calculate current zoom scale to preserve it
            let currentScale = 1.0;
            if (currentZoomMode === 'fixed') {
                currentScale = 1.0 / FIXED_ZOOM_OUT_FACTOR;
            } else if (currentZoomMode === 'adaptive') {
                const totalDuration = getTimelineDuration();
                if (totalDuration > 0) {
                    const totalWidth = totalDuration * PIXEL_PER_SECOND;
                    const availableWidth = window.innerWidth - 400;
                    currentScale = Math.min(1.0, availableWidth / totalWidth);
                }
            }

            // Apply zoom scale (preserve zoom, reset position)
            track.style.transform = `scale(${currentScale})`;
            track.style.transition = '';
            if (ruler) {
                ruler.style.transform = `scale(${currentScale})`;
                ruler.style.transition = '';
            }

            // Wait for scroll to complete
            setTimeout(() => {
                // IMPORTANT: Reset all state FIRST before anything else
                playbackSpeed = 1.0; // Reset speed FIRST
                
                // Clear and reset any existing media playback rate
                if (currentPlayingMedia) {
                    if (currentPlayingMedia.pause) {
                        currentPlayingMedia.pause();
                    }
                    // Reset playback rate if it's a video element
                    if (currentPlayingMedia.playbackRate !== undefined) {
                        currentPlayingMedia.playbackRate = 1.0;
                    }
                    currentPlayingMedia = null;
                }
                
                // Clear playback window content
                const playbackContent = document.getElementById('playbackWindowContent');
                if (playbackContent) {
                    playbackContent.innerHTML = '';
                }
                
                isPreviewMode = true;
                previewStartTime = performance.now();
                timelineStartTime = performance.now(); // Initialize global timeline
                isPreviewPaused = false; // Reset pause state
                pausedElapsedTime = 0;
                currentElementIndex = 0; // Reset element index

                // Activate UI
                const canvas = document.querySelector('.canvas');
                const overlay = document.getElementById('previewOverlay');
                const playbackWindow = document.getElementById('playbackWindow');
                const playbackControls = document.getElementById('playbackControls');
                const speedDisplayBubble = document.getElementById('speedDisplayBubble');
                const previewExitBtn = document.getElementById('previewExitBtn');
                const previewElementLabel = document.getElementById('previewElementLabel');

                canvas.classList.add('preview-mode');
                overlay.classList.add('active');
                playbackWindow.classList.add('active');
                speedDisplayBubble.classList.add('active');
                previewExitBtn.classList.add('active');
                previewElementLabel.classList.add('active');

                // Initialize speed display bubble and play/pause icons
                speedDisplayBubble.textContent = '1.0x';
                const pauseIcon = document.getElementById('pauseIcon');
                const playIcon = document.getElementById('playIcon');
                if (pauseIcon) pauseIcon.style.display = 'block';
                if (playIcon) playIcon.style.display = 'none';

                // Get first element's position AFTER scroll completes
                const firstElement = previewElements[0].element;

                // Calculate current zoom scale
                let currentScale = 1.0;
                if (currentZoomMode === 'fixed') {
                    currentScale = 1.0 / FIXED_ZOOM_OUT_FACTOR;
                } else if (currentZoomMode === 'adaptive') {
                    const totalDuration = getTimelineDuration();
                    if (totalDuration > 0) {
                        const totalWidth = totalDuration * PIXEL_PER_SECOND;
                        const availableWidth = window.innerWidth - 400;
                        currentScale = Math.min(1.0, availableWidth / totalWidth);
                    }
                }

                // Get the timeline track's bounding rect (this is the scaled container)
                const timelineTrack = document.getElementById('timelineTrack');
                const trackRect = timelineTrack.getBoundingClientRect();

                // Get the element's bounding rect (already reflects the scale transform)
                const rect = firstElement.getBoundingClientRect();

                // For absolute positioning, add scroll offsets
                const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

                // Calculate absolute position
                const absoluteLeft = rect.left + scrollLeft;
                const absoluteTop = rect.top + scrollTop;

                // Base dimensions (5 seconds = 200px width, portrait = 356px height)
                const baseWidth = 200;
                const baseHeight = 356;

                // Apply the same scale as the timeline to match visual size
                const scaledWidth = baseWidth * currentScale;
                const scaledHeight = baseHeight * currentScale;

                // Set playback window position and size (always 5-second width, portrait aspect)
                playbackWindow.style.transform = 'none';
                playbackWindow.style.left = `${absoluteLeft}px`;
                playbackWindow.style.top = `${absoluteTop}px`;
                playbackWindow.style.width = `${scaledWidth}px`;
                playbackWindow.style.height = `${scaledHeight}px`;

                console.log('Preview positioning:', {
                    scale: currentScale,
                    element: {left: rect.left, top: rect.top, width: rect.width, height: rect.height},
                    playbackWindow: {width: scaledWidth, height: scaledHeight},
                    scroll: {left: scrollLeft, top: scrollTop},
                    final: {left: absoluteLeft, top: absoluteTop}
                });

                // Position elements above the preview window (these are still fixed, so use viewport coords)
                const windowLeft = rect.left;
                const windowTop = rect.top;
                const windowWidth = scaledWidth;

                // Position X button above top-right corner
                previewExitBtn.style.left = `${windowLeft + windowWidth}px`;
                previewExitBtn.style.top = `${windowTop - 26}px`; // 26px above (6px + 20px margin)
                previewExitBtn.style.transform = 'translateX(-50%)'; // center on right edge

                // Position speed display next to X button (to its left)
                speedDisplayBubble.style.left = `${windowLeft + windowWidth - 30}px`; // 30px from right edge
                speedDisplayBubble.style.top = `${windowTop - 26}px`; // same height as X (6px + 20px margin)
                speedDisplayBubble.style.transform = 'translateX(-100%)'; // align to right

                // Position element label above top-left corner
                previewElementLabel.style.left = `${windowLeft}px`;
                previewElementLabel.style.top = `${windowTop - 26}px`; // 26px above (6px + 20px margin)
                previewElementLabel.style.transform = 'none';

                console.log('Playback window positioned at:', playbackWindow.style.left, playbackWindow.style.top);
                console.log('Starting playback...');

                // Start playing first element
                currentElementIndex = 0;
                playPreviewElement(0);
                
                // Start scroll detection
                lastScrollLeft = window.scrollX || window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft;
                scrollCheckActive = true;
                requestAnimationFrame(checkScroll);
            }, 600); // Wait for scroll to complete
        }

        // Stop preview mode
        function stopPreview() {
            if (!isPreviewMode) return;

            isPreviewMode = false;
            scrollCheckActive = false;
            
            // Keep the history state for a bit after stopping to prevent accidental back navigation
            setTimeout(() => {
                isHorizontalScrolling = false;
            }, 500);

            // Stop any playing media
            if (currentPlayingMedia) {
                if (currentPlayingMedia.pause) {
                    currentPlayingMedia.pause();
                }
                currentPlayingMedia = null;
            }

            // Cancel animation frame
            if (previewAnimationFrame) {
                cancelAnimationFrame(previewAnimationFrame);
                previewAnimationFrame = null;
            }

            // Reset all playback state
            playbackSpeed = 1.0;
            isPreviewPaused = false;
            pausedElapsedTime = 0;
            currentElementIndex = 0;

            // Deactivate UI
            const canvas = document.querySelector('.canvas');
            const overlay = document.getElementById('previewOverlay');
            const playbackWindow = document.getElementById('playbackWindow');
            const playbackControls = document.getElementById('playbackControls');
            const speedDisplayBubble = document.getElementById('speedDisplayBubble');
            const previewExitBtn = document.getElementById('previewExitBtn');
            const previewElementLabel = document.getElementById('previewElementLabel');
            const track = document.getElementById('timelineTrack');

            canvas.classList.remove('preview-mode');
            overlay.classList.remove('active');
            playbackWindow.classList.remove('active');
            speedDisplayBubble.classList.remove('active');
            previewExitBtn.classList.remove('active');
            previewElementLabel.classList.remove('active');

            // Reset play/pause button to play icon
            const pauseIcon = document.getElementById('pauseIcon');
            const playIcon = document.getElementById('playIcon');
            if (pauseIcon && playIcon) {
                pauseIcon.style.display = 'none';
                playIcon.style.display = 'block';
            }

            // Restore zoom but clear playback position
            const ruler = document.getElementById('timelineRuler');

            // Calculate current zoom scale to preserve it
            let currentScale = 1.0;
            if (currentZoomMode === 'fixed') {
                currentScale = 1.0 / FIXED_ZOOM_OUT_FACTOR;
            } else if (currentZoomMode === 'adaptive') {
                const totalDuration = getTimelineDuration();
                if (totalDuration > 0) {
                    const totalWidth = totalDuration * PIXEL_PER_SECOND;
                    const availableWidth = window.innerWidth - 400;
                    currentScale = Math.min(1.0, availableWidth / totalWidth);
                }
            }

            // Apply zoom scale (preserve zoom, clear playback position)
            track.style.transform = `scale(${currentScale})`;
            track.style.transition = '';
            if (ruler) {
                ruler.style.transform = `scale(${currentScale})`;
                ruler.style.transition = '';
            }

            // Clear playback window
            const playbackContent = document.getElementById('playbackWindowContent');
            playbackContent.innerHTML = '';
        }

        // Play a specific element by index
        function playPreviewElement(index) {
            if (index >= previewElements.length) {
                // End of preview - stop
                stopPreview();
                return;
            }

            currentElementIndex = index;
            const element = previewElements[index];
            const playbackContent = document.getElementById('playbackWindowContent');

            // Update element label to show current element type
            const previewElementLabel = document.getElementById('previewElementLabel');
            if (previewElementLabel) {
                // Format the type nicely (e.g., "video" -> "Video", "ai-video" -> "AI Video")
                let labelText = element.type || 'Element';
                labelText = labelText.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                previewElementLabel.textContent = labelText;
            }

            // Calculate when this element should start in the global timeline
            let elementGlobalStartTime = 0;
            for (let i = 0; i < index; i++) {
                elementGlobalStartTime += previewElements[i].duration;
            }

            // Clear existing content
            playbackContent.innerHTML = '';

            // Stop previous media
            if (currentPlayingMedia && currentPlayingMedia.pause) {
                currentPlayingMedia.pause();
            }

            console.log('Playing element', index, ':', element.type, element.mediaType, 'at global time:', elementGlobalStartTime);

            if (element.mediaType === 'video' && element.mediaUrl) {
                const video = document.createElement('video');
                video.src = element.mediaUrl;
                video.muted = false; // Enable audio
                video.playsInline = true;

                // Set looping if needed
                video.loop = element.shouldLoop || false;

                // Set playback rate - ensure it uses the current playbackSpeed value
                video.playbackRate = playbackSpeed;

                // Also set it when video is loaded to ensure it's applied
                video.addEventListener('loadedmetadata', () => {
                    video.playbackRate = playbackSpeed;

                    // Start from the specified time (for trimmed pool videos)
                    const startTime = element.videoStartTime || 0;
                    if (startTime > 0) {
                        video.currentTime = startTime;
                        console.log(`Starting video from ${startTime.toFixed(1)}s`);
                    }
                });

                video.style.width = '100%';
                video.style.height = '100%';
                video.style.objectFit = 'cover';
                video.style.position = 'relative';
                video.style.zIndex = '1';
                playbackContent.appendChild(video);
                currentPlayingMedia = video;

                // Monitor global timeline and stop at element duration
                const checkTime = () => {
                    if (!isPreviewMode || currentElementIndex !== index || isPreviewPaused) return;

                    // Calculate current position in global timeline
                    const currentGlobalTime = (performance.now() - timelineStartTime) / 1000 * playbackSpeed;
                    const elementEndTime = elementGlobalStartTime + element.duration;

                    if (currentGlobalTime >= elementEndTime) {
                        // Duration reached, move to next element
                        playPreviewElement(currentElementIndex + 1);
                    } else if (!video.paused && !video.ended) {
                        // Continue checking
                        requestAnimationFrame(checkTime);
                    }
                };

                // For looping videos, let them loop naturally
                // For trimmed videos, handle when they reach the end of the selected section
                if (!element.shouldLoop && element.videoStartTime !== undefined) {
                    const endTime = (element.videoStartTime || 0) + element.duration;

                    video.addEventListener('timeupdate', () => {
                        // If we've passed the end time for this section, move to next element
                        if (video.currentTime >= endTime) {
                            if (isPreviewMode && currentElementIndex === index) {
                                playPreviewElement(currentElementIndex + 1);
                            }
                        }
                    });
                }

                // Also handle natural video end (for non-looping videos)
                video.addEventListener('ended', () => {
                    if (isPreviewMode && currentElementIndex === index && !element.shouldLoop) {
                        playPreviewElement(currentElementIndex + 1);
                    }
                });

                // Start playing (or pause if in paused state)
                if (!isPreviewPaused) {
                    video.play().catch(err => console.log('Play error:', err));
                    requestAnimationFrame(checkTime);
                }

                // Start smooth timeline scrolling
                updateTimelinePosition();

            } else if (element.mediaType === 'image' && element.mediaUrl) {
                const img = document.createElement('img');
                img.src = element.mediaUrl;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.position = 'relative';
                img.style.zIndex = '1';
                playbackContent.appendChild(img);
                currentPlayingMedia = img;

                // Monitor global timeline for images
                const checkTime = () => {
                    if (!isPreviewMode || currentElementIndex !== index || isPreviewPaused) return;

                    const currentGlobalTime = (performance.now() - timelineStartTime) / 1000 * playbackSpeed;
                    const elementEndTime = elementGlobalStartTime + element.duration;

                    if (currentGlobalTime >= elementEndTime) {
                        playPreviewElement(currentElementIndex + 1);
                    } else {
                        requestAnimationFrame(checkTime);
                    }
                };

                if (!isPreviewPaused) {
                    requestAnimationFrame(checkTime);
                }

                updateTimelinePosition();

            } else {
                // Placeholder - just show text, no emoji
                const placeholder = document.createElement('div');
                placeholder.className = 'playback-window-placeholder';
                placeholder.textContent = element.placeholderText || 'No media';
                playbackContent.appendChild(placeholder);
                currentPlayingMedia = placeholder;

                // Monitor global timeline for placeholders
                const checkTime = () => {
                    if (!isPreviewMode || currentElementIndex !== index || isPreviewPaused) return;

                    const currentGlobalTime = (performance.now() - timelineStartTime) / 1000 * playbackSpeed;
                    const elementEndTime = elementGlobalStartTime + element.duration;

                    if (currentGlobalTime >= elementEndTime) {
                        playPreviewElement(currentElementIndex + 1);
                    } else {
                        requestAnimationFrame(checkTime);
                    }
                };

                if (!isPreviewPaused) {
                    requestAnimationFrame(checkTime);
                }

                updateTimelinePosition();
            }
        }

        // Update overlays based on current time
        function updateOverlays(currentTime) {
            const playbackContent = document.getElementById('playbackWindowContent');
            if (!playbackContent) return;

            // Remove existing overlays
            const existingOverlays = playbackContent.querySelectorAll('.preview-overlay');
            existingOverlays.forEach(o => o.remove());

            // Get edit track
            const editTrack = document.getElementById('editTrack');
            if (!editTrack) return;

            // Get all timeline elements to build a timeline position map
            const elementsRow = document.getElementById('elementsRow');
            const timelineElements = Array.from(elementsRow.querySelectorAll('.timeline-element')).filter(el => {
                if (el.dataset.elementId === 'initial') {
                    return el.dataset.finalized === 'true' && el.dataset.type && el.dataset.type !== 'none';
                }
                return true;
            });

            // Sort timeline elements by visual position (left to right)
            timelineElements.sort((a, b) => {
                return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
            });

            // Build cumulative time map for timeline elements
            const timelinePositions = [];
            let cumulativeTime = 0;
            timelineElements.forEach(el => {
                const duration = parseInt(el.dataset.duration) || 5;
                const left = el.getBoundingClientRect().left;
                timelinePositions.push({
                    left: left,
                    startTime: cumulativeTime,
                    endTime: cumulativeTime + duration,
                    duration: duration
                });
                cumulativeTime += duration;
            });

            // Get all finalized edit elements
            const editElements = Array.from(editTrack.querySelectorAll('.edit-element[data-finalized="true"]'));

            // Sort by vertical position (top) to ensure proper stacking order
            editElements.sort((a, b) => {
                const topA = parseInt(a.style.top) || 0;
                const topB = parseInt(b.style.top) || 0;
                return topA - topB;
            });

            // Calculate each edit's absolute time based on its visual position
            editElements.forEach((editEl, index) => {
                const editLeft = editEl.getBoundingClientRect().left;
                const editDuration = parseInt(editEl.dataset.duration) || 5;
                const overlayUrl = editEl.dataset.overlayUrl;

                if (!overlayUrl) return;

                // Calculate the edit's start time based on its position relative to timeline elements
                let editStartTime = 0;

                // Find where this edit sits on the timeline
                for (let i = 0; i < timelinePositions.length; i++) {
                    const pos = timelinePositions[i];

                    if (i === timelinePositions.length - 1) {
                        // Last element - calculate offset from this element
                        const offsetPixels = editLeft - pos.left;
                        const PIXEL_PER_SECOND = 40; // Match the constant from resize
                        const offsetSeconds = offsetPixels / PIXEL_PER_SECOND;
                        editStartTime = pos.startTime + Math.max(0, offsetSeconds);
                        break;
                    } else {
                        const nextPos = timelinePositions[i + 1];
                        if (editLeft >= pos.left && editLeft < nextPos.left) {
                            // Edit is between this element and the next
                            const offsetPixels = editLeft - pos.left;
                            const PIXEL_PER_SECOND = 40;
                            const offsetSeconds = offsetPixels / PIXEL_PER_SECOND;
                            editStartTime = pos.startTime + Math.max(0, offsetSeconds);
                            break;
                        }
                    }
                }

                const editEndTime = editStartTime + editDuration;

                // Check if this overlay should be visible at current time
                if (currentTime >= editStartTime && currentTime < editEndTime) {
                    const topValue = editEl.style.top || '0px';
                    console.log(`✓ Showing overlay ${index} (top: ${topValue}) at ${currentTime.toFixed(2)}s (range: ${editStartTime.toFixed(2)}s-${editEndTime.toFixed(2)}s) with z-index: ${9999 + index}`);

                    // If overlayUrl exists, show the canvas image
                    if (overlayUrl && overlayUrl !== 'undefined') {
                        const overlay = document.createElement('img');
                        overlay.src = overlayUrl;
                        overlay.className = 'preview-overlay';
                        // Use incremental z-index so stacked edits are all visible
                        overlay.style.cssText = `
                            position: absolute !important;
                            top: 0 !important;
                            left: 0 !important;
                            width: 100% !important;
                            height: 100% !important;
                            object-fit: contain !important;
                            pointer-events: none !important;
                            z-index: ${9999 + index} !important;
                            display: block !important;
                        `;
                        playbackContent.appendChild(overlay);
                        console.log(`  → Appended overlay ${index} with src length: ${overlayUrl.length}`);
                    } else {
                        console.log(`  → Overlay ${index} skipped (no valid URL)`);
                    }
                }
            });
        }

        // Update timeline scroll position based on global elapsed time
        function updateTimelinePosition() {
            if (!isPreviewMode || isPreviewPaused) {
                if (isPreviewMode && !isPreviewPaused) {
                    requestAnimationFrame(updateTimelinePosition);
                }
                return;
            }

            const track = document.getElementById('timelineTrack');
            const ruler = document.getElementById('timelineRuler');

            // Calculate total elapsed time from the start
            const totalElapsed = (performance.now() - timelineStartTime) / 1000 * playbackSpeed;

            // Update overlays
            updateOverlays(totalElapsed);

            // Calculate current zoom scale
            let currentScale = 1.0;
            if (currentZoomMode === 'fixed') {
                currentScale = 1.0 / FIXED_ZOOM_OUT_FACTOR;
            } else if (currentZoomMode === 'adaptive') {
                const totalDuration = getTimelineDuration();
                if (totalDuration > 0) {
                    const totalWidth = totalDuration * PIXEL_PER_SECOND;
                    const availableWidth = window.innerWidth - 400;
                    currentScale = Math.min(1.0, availableWidth / totalWidth);
                }
            }

            // Convert to pixels and scroll timeline smoothly
            const pixelsPlayed = totalElapsed * PIXEL_PER_SECOND;

            // Combine zoom scale with playback position
            const transformValue = `scale(${currentScale}) translateX(${-pixelsPlayed}px)`;
            track.style.transform = transformValue;
            track.style.transition = 'none';

            // Apply same transform to timeline ruler
            if (ruler) {
                ruler.style.transform = transformValue;
                ruler.style.transition = 'none';
            }

            // Always continue updating while in preview mode
            requestAnimationFrame(updateTimelinePosition);
        }

        // Initialize
        document.addEventListener('DOMContentLoaded', async () => {
            // Initialize API
            initApi();

            // Load template from API if we have a template ID
            if (currentTemplateId) {
                try {
                    const template = await loadTemplateFromApi();
                    if (template && template.timeline_data) {
                        console.log('Template loaded:', template.name);
                        await applyTemplateToTimeline(template.timeline_data);
                    }
                } catch (err) {
                    console.error('Error loading template:', err);
                }
            }

            // Initialize IndexedDB and load pools
            try {
                await initDB();
                await loadPools();
                console.log('Pools loaded:', { videoPools, imagePools });
            } catch (err) {
                console.error('Error initializing database:', err);
            }

            initializeTimelineRuler();

            const initialAddBtn = document.querySelector('.add-element-btn');
            if (initialAddBtn) {
                initialAddBtn.addEventListener('click', (e) => showDropdown(initialAddBtn, e));
            }

            const initialAddEditBtn = document.querySelector('.add-edit-btn');
            if (initialAddEditBtn) {
                initialAddEditBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const editElement = initialAddEditBtn.closest('.edit-element');
                    showEditTextModal(e, editElement);
                });
            }

            // Setup resize handlers for the initial edit element
            const initialEditElement = document.querySelector('.edit-element');
            if (initialEditElement) {
                // Position it at left: 0
                initialEditElement.style.left = '0px';
                setupEditResizeHandlers(initialEditElement);
            }

            // Position playback controls under first element
            function positionPlaybackControls() {
                const firstElement = document.querySelector('.timeline-element');
                const playbackControls = document.getElementById('playbackControls');
                const exportButtonInline = document.getElementById('exportButtonInline');
                const seeJsonButtonInline = document.getElementById('seeJsonButtonInline');
                const zoomControls = document.getElementById('zoomControls');

                if (firstElement && playbackControls) {
                    const rect = firstElement.getBoundingClientRect();
                    const windowWidth = 200;
                    const windowHeight = 356;

                    const topValue = rect.top + windowHeight + 6;
                    const topPosition = `${topValue}px`;

                    playbackControls.style.left = `${rect.left + (windowWidth / 2)}px`;
                    playbackControls.style.top = topPosition;
                    playbackControls.style.transform = 'translateX(-50%)';

                    // Position inline export button at same Y position, but on the right (20px lower)
                    if (exportButtonInline) {
                        exportButtonInline.style.top = `${topValue + 20}px`;
                        exportButtonInline.style.transform = 'translateY(-50%)';
                        exportButtonInline.style.right = '24px';
                    }

                    // Position See JSON button right next to Export button (to its left)
                    if (seeJsonButtonInline && exportButtonInline) {
                        const exportWidth = exportButtonInline.offsetWidth || 100;
                        seeJsonButtonInline.style.top = `${topValue + 20}px`;
                        seeJsonButtonInline.style.transform = 'translateY(-50%)';
                        seeJsonButtonInline.style.right = `${24 + exportWidth + 8}px`; // 24px base + export width + 8px gap
                    }

                    // Position zoom controls 10px to the left of the timeline track, centered vertically
                    if (zoomControls) {
                        zoomControls.style.left = `${rect.left - 10}px`;
                        zoomControls.style.top = `${rect.top + (windowHeight / 2)}px`;
                        zoomControls.style.transform = 'translate(-100%, -50%)';
                    }
                }
            }

            // Position controls on load and when window resizes
            positionPlaybackControls();
            window.addEventListener('resize', positionPlaybackControls);

            // Apply zoom transform to timeline containers
            function applyZoomTransform(mode) {
                currentZoomMode = mode;

                let scale = 1.0;
                if (mode === 'fixed') {
                    scale = 1.0 / FIXED_ZOOM_OUT_FACTOR; // 3x zoom out = 0.333 scale
                } else if (mode === 'adaptive') {
                    // Calculate scale to fit entire timeline in viewport
                    const totalDuration = getTimelineDuration();
                    if (totalDuration > 0) {
                        const totalWidth = totalDuration * PIXEL_PER_SECOND;
                        const availableWidth = window.innerWidth - 400; // Leave room for UI
                        scale = Math.min(1.0, availableWidth / totalWidth);
                    }
                }

                // Apply CSS transform to the timeline track and ruler
                const timelineTrack = document.getElementById('timelineTrack');
                const timelineRuler = document.getElementById('timelineRuler');

                if (timelineTrack) {
                    timelineTrack.style.transform = `scale(${scale})`;
                    timelineTrack.style.transformOrigin = 'left center';
                    timelineTrack.style.transition = 'transform 0.3s ease';
                }

                if (timelineRuler) {
                    timelineRuler.style.transform = `scale(${scale})`;
                    timelineRuler.style.transformOrigin = 'left center';
                    timelineRuler.style.transition = 'transform 0.3s ease';
                }

                // Update button states
                updateZoomButtonStates();
            }

            // Update zoom button active states
            function updateZoomButtonStates() {
                const zoomDefaultBtn = document.getElementById('zoomDefaultBtn');
                const zoomAdaptiveBtn = document.getElementById('zoomAdaptiveBtn');
                const zoomOutBtn = document.getElementById('zoomOutBtn');

                // Remove active class from all
                zoomDefaultBtn.classList.remove('active');
                zoomAdaptiveBtn.classList.remove('active');
                zoomOutBtn.classList.remove('active');

                // Add active class to current mode
                if (currentZoomMode === 'default') {
                    zoomDefaultBtn.classList.add('active');
                } else if (currentZoomMode === 'adaptive') {
                    zoomAdaptiveBtn.classList.add('active');
                } else if (currentZoomMode === 'fixed') {
                    zoomOutBtn.classList.add('active');
                }
            }

            // View toggle on scroll
            let lastScrollY = window.scrollY;
            let isViewSwapped = false;
            const timelineTrack = document.getElementById('timelineTrack');

            window.addEventListener('scroll', () => {
                // Don't change view during preview mode
                if (isPreviewMode) {
                    return;
                }

                const currentScrollY = window.scrollY;
                const scrollDirection = currentScrollY < lastScrollY ? 'up' : 'down';

                // Toggle view on scroll up or down
                if (scrollDirection === 'down' && !isViewSwapped) {
                    // Scroll down - swap to edit view
                    timelineTrack.classList.add('view-swapped');
                    isViewSwapped = true;
                } else if (scrollDirection === 'up' && isViewSwapped) {
                    // Scroll up - return to normal view
                    timelineTrack.classList.remove('view-swapped');
                    isViewSwapped = false;
                }

                lastScrollY = currentScrollY;
            });

            // Enhanced horizontal scroll speed
            const canvas = document.querySelector('.canvas');
            let isScrolling = false;

            // Prevent browser back/forward navigation during horizontal scrolling
            let isHorizontalScrolling = false;
            let horizontalScrollTimeout = null;
            let hasPushedState = false;
            
            // Push a state to prevent back navigation when scrolling horizontally
            function preventBackNavigation() {
                if (!hasPushedState) {
                    hasPushedState = true;
                    // Push a dummy state to prevent back navigation
                    history.pushState({ preventBack: true, timestamp: Date.now() }, '');
                }
                
                isHorizontalScrolling = true;
                
                // Clear existing timeout
                if (horizontalScrollTimeout) {
                    clearTimeout(horizontalScrollTimeout);
                }
                
                // Reset flag after scrolling stops
                horizontalScrollTimeout = setTimeout(() => {
                    isHorizontalScrolling = false;
                }, 300);
            }
            
            // Push initial state to prevent back navigation
            if (history.state === null) {
                history.replaceState({ preventBack: true, timestamp: Date.now() }, '');
                hasPushedState = true;
            }

            // Prevent popstate (back/forward) when it was caused by our horizontal scrolling
            let lastPopStateTime = 0;
            window.addEventListener('popstate', (e) => {
                const now = Date.now();
                // ALWAYS prevent if we're in preview mode, scrolling horizontally, or if it's our prevent state
                if (isPreviewMode || isHorizontalScrolling || e.state?.preventBack || e.state?.previewMode || (now - lastPopStateTime < 1000)) {
                    // Immediately push state back to prevent navigation
                    setTimeout(() => {
                        const stateData = { 
                            preventBack: true, 
                            previewMode: isPreviewMode,
                            timestamp: Date.now() 
                        };
                        history.pushState(stateData, '');
                        hasPushedState = true;
                    }, 0);
                    lastPopStateTime = now;
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return false;
                }
            }, true); // Use capture phase to catch it early

            canvas.addEventListener('wheel', (e) => {
                const isHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
                
                // If preview is active and user is scrolling horizontally, stop preview
                if (isPreviewMode && isHorizontal) {
                    stopPreview();
                    // Still prevent navigation
                    preventBackNavigation();
                    return; // Don't prevent default, allow normal scroll
                }
                
                // If shift is held OR scrolling horizontally, increase scroll speed
                if (e.shiftKey || isHorizontal) {
                    e.preventDefault();
                    
                    // Prevent browser navigation - do this BEFORE scrolling
                    preventBackNavigation();
                    
                    const scrollAmount = e.deltaY !== 0 ? e.deltaY : e.deltaX;
                    window.scrollBy({
                        left: scrollAmount * 2, // 2x faster horizontal scroll
                        behavior: 'auto'
                    });
                }
            }, { passive: false });

            // Stop preview on horizontal scroll - use requestAnimationFrame for better detection
            function checkScroll() {
                if (!isPreviewMode || !scrollCheckActive) return;
                
                const currentScrollLeft = window.scrollX || window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft;
                // Check if horizontal scroll happened
                if (Math.abs(currentScrollLeft - lastScrollLeft) > 5) {
                    stopPreview();
                    scrollCheckActive = false;
                    lastScrollLeft = currentScrollLeft;
                } else {
                    lastScrollLeft = currentScrollLeft;
                    requestAnimationFrame(checkScroll);
                }
            }

            // Also listen to scroll events as backup
            window.addEventListener('scroll', () => {
                const currentScrollLeft = window.scrollX || window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft;
                
                // Check if this is horizontal scrolling
                if (Math.abs(currentScrollLeft - lastScrollLeft) > 5) {
                    // Prevent browser navigation during horizontal scroll
                    preventBackNavigation();
                    
                    if (isPreviewMode) {
                        stopPreview();
                    }
                }
                lastScrollLeft = currentScrollLeft;
            }, { passive: true });

            // Prevent Safari swipe navigation gestures during horizontal scrolling
            let touchStartX = 0;
            let touchStartY = 0;
            let isHorizontalScroll = false;

            document.addEventListener('touchstart', (e) => {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                isHorizontalScroll = false;
            }, { passive: true });

            document.addEventListener('touchmove', (e) => {
                if (!touchStartX || !touchStartY) return;
                
                const touchCurrentX = e.touches[0].clientX;
                const touchCurrentY = e.touches[0].clientY;
                const deltaX = Math.abs(touchCurrentX - touchStartX);
                const deltaY = Math.abs(touchCurrentY - touchStartY);
                
                // Determine if this is primarily horizontal scrolling
                if (deltaX > deltaY && deltaX > 10) {
                    isHorizontalScroll = true;
                    // Prevent Safari's swipe navigation and browser back/forward
                    preventBackNavigation();
                    e.preventDefault();
                }
            }, { passive: false });

            document.addEventListener('touchend', () => {
                // If preview is active and horizontal scroll happened, stop preview
                if (isPreviewMode && isHorizontalScroll) {
                    stopPreview();
                }
                touchStartX = 0;
                touchStartY = 0;
                isHorizontalScroll = false;
            }, { passive: true });

            // Cmd+Z / Ctrl+Z for undo
            document.addEventListener('keydown', (e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                    e.preventDefault();
                    undoDelete();
                }
            });

            // Click on duration indicator to edit
            document.addEventListener('click', (e) => {
                const durationIndicator = e.target.closest('.duration-indicator');
                if (!durationIndicator) return;

                // Don't edit if it already has an input
                if (durationIndicator.querySelector('input')) return;

                const element = durationIndicator.closest('.timeline-element, .edit-element');
                if (!element) return;

                const currentDuration = parseInt(element.dataset.duration) || 5;
                const originalText = durationIndicator.textContent;

                // Replace text with input
                durationIndicator.innerHTML = `<input type="number" min="1" max="${MAX_DURATION}" value="${currentDuration}" />s`;
                const input = durationIndicator.querySelector('input');
                input.focus();
                input.select();

                // Handle input completion
                const finishEdit = () => {
                    let newDuration = parseInt(input.value);

                    // Validate and clamp duration
                    if (isNaN(newDuration) || newDuration < 1) {
                        // Invalid - restore original
                        durationIndicator.textContent = originalText;
                        return;
                    }

                    // Clamp to minimum 1 second
                    newDuration = Math.max(1, newDuration);

                    const elementType = element.dataset.type;

                    // Apply element-type-specific duration rules
                    if (elementType === 'ai-video') {
                        // AI Video: max 12 seconds
                        newDuration = Math.min(12, newDuration);
                    } else if (elementType === 'video') {
                        // Direct video upload: can only be equal to or shorter than original
                        const originalDuration = parseInt(element.dataset.originalDuration);
                        if (originalDuration) {
                            newDuration = Math.min(originalDuration, newDuration);
                        }
                        // Also check against MAX_DURATION
                        newDuration = Math.min(MAX_DURATION, newDuration);
                    } else if (elementType === 'pool') {
                        // Pool elements: check pool type
                        const poolType = element.dataset.poolType;
                        if (poolType === 'video') {
                            // Video pool: can only be equal to or shorter than the longest video
                            const poolData = element.dataset.poolData;
                            if (poolData) {
                                try {
                                    const pool = JSON.parse(poolData);
                                    let maxVideoDuration = 1;
                                    pool.files.forEach(file => {
                                        if (file.duration && file.duration > maxVideoDuration) {
                                            maxVideoDuration = file.duration;
                                        }
                                    });
                                    newDuration = Math.min(Math.floor(maxVideoDuration), newDuration);
                                } catch (err) {
                                    console.error('Error validating pool:', err);
                                }
                            }
                        } else {
                            // Image pool: any duration up to MAX_DURATION
                            newDuration = Math.min(MAX_DURATION, newDuration);
                        }
                    } else {
                        // All other types (image, ai-image, edit): any duration up to MAX_DURATION
                        newDuration = Math.min(MAX_DURATION, newDuration);
                    }

                    // Update duration
                    element.dataset.duration = newDuration;
                    durationIndicator.textContent = `${newDuration}s`;

                    // Update element width
                    updateElementWidth(element);

                    // Reposition empty slots
                    repositionEmptyEditSlot();
                };

                // Finish on Enter or blur
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        input.blur();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        durationIndicator.textContent = originalText;
                    }
                });

                input.addEventListener('blur', finishEdit);
            });

            // Click on element type badge to edit name
            document.addEventListener('click', (e) => {
                const typeBadge = e.target.closest('.element-type-badge');
                if (!typeBadge) return;

                // Don't edit if it already has an input
                if (typeBadge.querySelector('input')) return;

                const element = typeBadge.closest('.timeline-element, .edit-element');
                if (!element) return;

                // Get current name
                const currentText = typeBadge.textContent.trim();
                const currentName = element.dataset.elementName || currentText;
                const originalText = currentText;

                // Store the current badge width before replacing (use actual width or a small default)
                const badgeWidth = typeBadge.offsetWidth || 80;
                
                // Replace content with input
                typeBadge.innerHTML = `<input type="text" value="${currentName}" />`;
                const input = typeBadge.querySelector('input');
                
                // Ensure the badge maintains its current width (don't expand)
                typeBadge.style.width = `${badgeWidth}px`;
                typeBadge.style.maxWidth = `${badgeWidth}px`;
                typeBadge.style.minWidth = `${badgeWidth}px`;
                
                input.focus();
                input.select();

                // Handle input completion
                const finishEdit = () => {
                    let newName = input.value.trim();

                    // Reset width to auto so badge sizes to content
                    typeBadge.style.width = 'auto';
                    typeBadge.style.maxWidth = '150px';
                    typeBadge.style.minWidth = '60px';

                    // If empty, restore original
                    if (!newName) {
                        typeBadge.textContent = originalText;
                        typeBadge.style.textTransform = 'uppercase';
                        return;
                    }

                    // Update element name (preserve as-is, no uppercase)
                    element.dataset.elementName = newName;
                    typeBadge.textContent = newName;
                    // Remove uppercase transformation for custom names
                    typeBadge.style.textTransform = 'none';
                };

                // Finish on Enter or blur
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        input.blur();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        typeBadge.textContent = originalText;
                    }
                });

                input.addEventListener('blur', finishEdit);
            });

            // Space bar for play/pause or start preview
            document.addEventListener('keydown', (e) => {
                // Only handle space if not typing in an input field
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                    return;
                }
                
                if (e.key === ' ' || e.code === 'Space') {
                    e.preventDefault();
                    
                    if (isPreviewMode) {
                        // Toggle play/pause
                        togglePlayPause();
                    } else {
                        // Start preview
                        startPreview();
                    }
                }
            });


            // Click overlay to stop preview
            const previewOverlay = document.getElementById('previewOverlay');
            previewOverlay.addEventListener('click', () => {
                if (isPreviewMode) {
                    stopPreview();
                }
            });

            // Click X button to exit preview
            const previewExitBtn = document.getElementById('previewExitBtn');
            previewExitBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent overlay click from firing
                if (isPreviewMode) {
                    stopPreview();
                }
            });

            // Click any timeline element to exit preview
            document.addEventListener('click', (e) => {
                if (!isPreviewMode) return;

                // Check if clicked element is a timeline element
                const clickedElement = e.target.closest('.timeline-element');
                if (clickedElement) {
                    stopPreview();
                }
            });

            // ===== PLAYBACK CONTROL FUNCTIONS =====

            function updateSpeedDisplay() {
                const speedDisplayBubble = document.getElementById('speedDisplayBubble');
                // Show 2 decimals for 0.25, 1 decimal for all other values
                if (Math.abs(playbackSpeed - 0.25) < 0.01) {
                    speedDisplayBubble.textContent = playbackSpeed.toFixed(2) + 'x';
                } else {
                    speedDisplayBubble.textContent = playbackSpeed.toFixed(1) + 'x';
                }
            }

            function updatePlayPauseIcon() {
                const pauseIcon = document.getElementById('pauseIcon');
                const playIcon = document.getElementById('playIcon');
                if (isPreviewPaused) {
                    pauseIcon.style.display = 'none';
                    playIcon.style.display = 'block';
                } else {
                    pauseIcon.style.display = 'block';
                    playIcon.style.display = 'none';
                }
            }

            function togglePlayPause() {
                // If preview is not active, start it
                if (!isPreviewMode) {
                    startPreview();
                    return;
                }

                isPreviewPaused = !isPreviewPaused;

                if (isPreviewPaused) {
                    // Save current elapsed time
                    pausedElapsedTime = (performance.now() - timelineStartTime) / 1000 * playbackSpeed;

                    // Pause video if playing
                    if (currentPlayingMedia && currentPlayingMedia.pause) {
                        currentPlayingMedia.pause();
                    }
                } else {
                    // Resume: adjust timeline start time to account for pause
                    timelineStartTime = performance.now() - (pausedElapsedTime / playbackSpeed * 1000);

                    // Resume video if paused
                    if (currentPlayingMedia && currentPlayingMedia.play) {
                        // Ensure video has correct playback rate
                        if (currentPlayingMedia.playbackRate !== undefined) {
                            currentPlayingMedia.playbackRate = playbackSpeed;
                        }
                        currentPlayingMedia.play().catch(err => console.log('Play error:', err));
                    }

                    // Restart timeline scrolling
                    updateTimelinePosition();

                    // Restart the checkTime loop for the current element
                    resumeCurrentElementTimingCheck();
                }

                updatePlayPauseIcon();
            }

            // Resume timing check for current element without recreating it
            function resumeCurrentElementTimingCheck() {
                const element = previewElements[currentElementIndex];

                // Calculate when this element should start in the global timeline
                let elementGlobalStartTime = 0;
                for (let i = 0; i < currentElementIndex; i++) {
                    elementGlobalStartTime += previewElements[i].duration;
                }

                const checkTime = () => {
                    if (!isPreviewMode || isPreviewPaused) return;

                    const currentGlobalTime = (performance.now() - timelineStartTime) / 1000 * playbackSpeed;
                    const elementEndTime = elementGlobalStartTime + element.duration;

                    if (currentGlobalTime >= elementEndTime) {
                        playPreviewElement(currentElementIndex + 1);
                    } else {
                        requestAnimationFrame(checkTime);
                    }
                };

                requestAnimationFrame(checkTime);
            }

            function changeSpeed(delta) {
                if (!isPreviewMode) return;

                // Calculate current content time (how much content has played)
                const currentContentTime = isPreviewPaused
                    ? pausedElapsedTime
                    : (performance.now() - timelineStartTime) / 1000 * playbackSpeed;

                // Update speed (clamp between 0.25x and 4x)
                playbackSpeed = Math.max(0.25, Math.min(4.0, playbackSpeed + delta));

                // Recalculate timeline start time to maintain the same content position
                timelineStartTime = performance.now() - (currentContentTime / playbackSpeed * 1000);

                if (isPreviewPaused) {
                    pausedElapsedTime = currentContentTime;
                }

                // Update video playback rate if it's a video
                if (currentPlayingMedia && currentPlayingMedia.playbackRate !== undefined) {
                    currentPlayingMedia.playbackRate = playbackSpeed;
                }

                updateSpeedDisplay();
            }

            function changeSpeedByStep(direction) {
                if (!isPreviewMode) return;

                // Define the allowed speed values
                const speedValues = [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
                
                // Find the current speed's index (or closest)
                let currentIndex = speedValues.findIndex(val => Math.abs(val - playbackSpeed) < 0.01);
                
                // If not found, find the closest value
                if (currentIndex === -1) {
                    currentIndex = speedValues.reduce((closest, val, idx) => {
                        return Math.abs(val - playbackSpeed) < Math.abs(speedValues[closest] - playbackSpeed) ? idx : closest;
                    }, 0);
                }

                // Move to next/previous speed value
                if (direction > 0) {
                    // Speed up
                    currentIndex = Math.min(currentIndex + 1, speedValues.length - 1);
                } else {
                    // Slow down
                    currentIndex = Math.max(currentIndex - 1, 0);
                }

                // Calculate the delta needed to reach the target speed
                const targetSpeed = speedValues[currentIndex];
                const delta = targetSpeed - playbackSpeed;
                
                changeSpeed(delta);
            }

            // Previous/Next element functions
            function previousElement() {
                if (!isPreviewMode || currentElementIndex <= 0) return;

                // Calculate elapsed time up to previous element
                let timeUpToPrevious = 0;
                for (let i = 0; i < currentElementIndex - 1; i++) {
                    timeUpToPrevious += previewElements[i].duration;
                }

                // Adjust timeline start time to jump to previous element
                timelineStartTime = performance.now() - (timeUpToPrevious / playbackSpeed * 1000);

                // Play the previous element
                playPreviewElement(currentElementIndex - 1);
            }

            function nextElement() {
                if (!isPreviewMode || currentElementIndex >= previewElements.length - 1) return;

                // Calculate elapsed time up to next element
                let timeUpToNext = 0;
                for (let i = 0; i <= currentElementIndex; i++) {
                    timeUpToNext += previewElements[i].duration;
                }

                // Adjust timeline start time to jump to next element
                timelineStartTime = performance.now() - (timeUpToNext / playbackSpeed * 1000);

                // Play the next element
                playPreviewElement(currentElementIndex + 1);
            }

            // Wire up playback control button events
            const playPauseBtn = document.getElementById('playPauseBtn');
            const slowDownBtn = document.getElementById('slowDownBtn');
            const speedUpBtn = document.getElementById('speedUpBtn');
            const prevElementBtn = document.getElementById('prevElementBtn');
            const nextElementBtn = document.getElementById('nextElementBtn');

            playPauseBtn.addEventListener('click', togglePlayPause);
            slowDownBtn.addEventListener('click', () => changeSpeedByStep(-1));
            speedUpBtn.addEventListener('click', () => changeSpeedByStep(1));
            prevElementBtn.addEventListener('click', previousElement);
            nextElementBtn.addEventListener('click', nextElement);

            // ===== ZOOM CONTROL EVENT LISTENERS =====
            const zoomDefaultBtn = document.getElementById('zoomDefaultBtn');
            const zoomAdaptiveBtn = document.getElementById('zoomAdaptiveBtn');
            const zoomOutBtn = document.getElementById('zoomOutBtn');

            zoomDefaultBtn.addEventListener('click', () => {
                applyZoomTransform('default');
            });

            zoomAdaptiveBtn.addEventListener('click', () => {
                applyZoomTransform('adaptive');
            });

            zoomOutBtn.addEventListener('click', () => {
                applyZoomTransform('fixed');
            });

            // ===== POOL MODAL EVENT LISTENERS =====

            // Modal close on overlay click
            const modalOverlay = document.getElementById('poolModal');
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) {
                    closePoolModal();
                }
            });

            // Modal cancel button
            const modalCancel = document.getElementById('modalCancel');
            modalCancel.addEventListener('click', closePoolModal);

            // Modal create button
            const modalCreate = document.getElementById('modalCreate');
            console.log('modalCreate button:', modalCreate);
            if (modalCreate) {
                modalCreate.addEventListener('click', (e) => {
                    console.log('Create Pool button clicked!');
                    createPool(e);
                });
            } else {
                console.error('modalCreate button not found!');
            }

            // File input change
            const poolFileInput = document.getElementById('poolFileInput');
            poolFileInput.addEventListener('change', (e) => {
                addFilesToPreview(e.target.files);
            });

            // Drop zone click to open file picker
            const dropZone = document.getElementById('dropZone');
            dropZone.addEventListener('click', () => {
                poolFileInput.click();
            });

            // Drag and drop events
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('dragging');
            });

            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('dragging');
            });

            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragging');
                addFilesToPreview(e.dataTransfer.files);
            });

            // Close dropdowns when clicking outside
            document.addEventListener('click', () => {
                document.querySelectorAll('.custom-dropdown-list').forEach(l => l.classList.remove('open'));
                document.querySelectorAll('.custom-dropdown-trigger').forEach(t => t.classList.remove('open'));
                document.querySelectorAll('.edit-binding-menu').forEach(m => m.classList.remove('open'));
            });

            // ===== TRIM EDITOR MODAL EVENT LISTENERS =====

            const trimEditorModal = document.getElementById('trimEditorModal');
            const trimEditorCancel = document.getElementById('trimEditorCancel');
            const trimEditorOk = document.getElementById('trimEditorOk');
            const trimEditorPlayBtn = document.getElementById('trimEditorPlayBtn');

            // Close on overlay click
            trimEditorModal.addEventListener('click', (e) => {
                if (e.target === trimEditorModal) {
                    closeTrimEditorModal();
                }
            });

            // Cancel button
            trimEditorCancel.addEventListener('click', closeTrimEditorModal);

            // OK button
            trimEditorOk.addEventListener('click', () => {
                // TODO: Save the trim selection (startTime stored in trimEditorStartTime)
                console.log('Trim selection saved:', {
                    file: trimEditorFile.name,
                    startTime: trimEditorStartTime,
                    duration: trimEditorDuration
                });
                closeTrimEditorModal();
            });

            // Play button
            trimEditorPlayBtn.addEventListener('click', () => {
                const previewVideo = document.getElementById('trimEditorPreviewVideo');
                previewVideo.currentTime = trimEditorStartTime;
                previewVideo.play();

                // Stop at end of selection
                const stopTime = trimEditorStartTime + trimEditorDuration;
                const checkTime = setInterval(() => {
                    if (previewVideo.currentTime >= stopTime) {
                        previewVideo.pause();
                        previewVideo.currentTime = trimEditorStartTime;
                        clearInterval(checkTime);
                    }
                }, 100);
            });

            // ===== EXCLUDED VIDEO MODAL EVENT LISTENERS =====

            const excludedVideoModal = document.getElementById('excludedVideoModal');
            const excludedVideoCancel = document.getElementById('excludedVideoCancel');
            const excludedVideoOk = document.getElementById('excludedVideoOk');
            const loopBtn = document.getElementById('loopBtn');

            // Close on overlay click
            excludedVideoModal.addEventListener('click', (e) => {
                if (e.target === excludedVideoModal) {
                    closeExcludedVideoModal();
                }
            });

            // Cancel button
            excludedVideoCancel.addEventListener('click', closeExcludedVideoModal);

            // OK button
            excludedVideoOk.addEventListener('click', async () => {
                const previewVideo = document.getElementById('excludedVideoPreview');
                const shouldLoop = previewVideo.loop;

                // Update the file's loop property in the pool
                if (excludedVideoFile && excludedVideoPool && excludedVideoElementDiv) {
                    const fileIndex = excludedVideoPool.files.findIndex(f => f.name === excludedVideoFile.name);
                    if (fileIndex !== -1) {
                        excludedVideoPool.files[fileIndex].loop = shouldLoop;

                        // Update pool in IndexedDB
                        const poolType = excludedVideoElementDiv.dataset.type || 'video';
                        await updatePool(excludedVideoPool, poolType);

                        // Update dataset
                        excludedVideoElementDiv.dataset.poolData = JSON.stringify(excludedVideoPool);

                        // Refresh thumbnail display
                        displayPoolThumbnails(excludedVideoElementDiv, excludedVideoPool);
                    }
                }

                closeExcludedVideoModal();
            });

            // Loop button - immediately save and close
            loopBtn.addEventListener('click', async () => {
                const previewVideo = document.getElementById('excludedVideoPreview');
                const shouldLoop = !previewVideo.loop;
                previewVideo.loop = shouldLoop;

                // Update the file's loop property in the pool
                if (excludedVideoFile && excludedVideoPool && excludedVideoElementDiv) {
                    const fileIndex = excludedVideoPool.files.findIndex(f => f.name === excludedVideoFile.name);
                    if (fileIndex !== -1) {
                        excludedVideoPool.files[fileIndex].loop = shouldLoop;

                        // Update pool in IndexedDB
                        const poolType = excludedVideoElementDiv.dataset.type || 'video';
                        await updatePool(excludedVideoPool, poolType);

                        // Update dataset
                        excludedVideoElementDiv.dataset.poolData = JSON.stringify(excludedVideoPool);

                        // Refresh thumbnail display
                        displayPoolThumbnails(excludedVideoElementDiv, excludedVideoPool);
                    }
                }

                // Close modal immediately
                closeExcludedVideoModal();
            });

            // ===== AI VIDEO MODAL FUNCTIONALITY =====

            const aiVideoModal = document.getElementById('aiVideoModal');
            const aiVideoPrompt = document.getElementById('aiVideoPrompt');
            const aiVideoModel = document.getElementById('aiVideoModel');
            const aiVideoDuration = document.getElementById('aiVideoDuration');
            const aiVideoImage = document.getElementById('aiVideoImage');
            const aiVideoCancel = document.getElementById('aiVideoCancel');
            const aiVideoOk = document.getElementById('aiVideoOk');

            // Handle image upload
            aiVideoImage.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        aiVideoInputImageData = event.target.result;
                        console.log('AI Video input image loaded', {
                            fileName: file.name,
                            fileSize: file.size,
                            dataLength: aiVideoInputImageData.length,
                            hasData: !!aiVideoInputImageData
                        });
                        
                        // Show preview
                        const preview = document.getElementById('aiVideoImagePreview');
                        const previewImg = document.getElementById('aiVideoImagePreviewImg');
                        if (preview && previewImg) {
                            previewImg.src = aiVideoInputImageData;
                            preview.style.display = 'block';
                            // Input field text is below, so no need to hide it
                        }
                    };
                    reader.onerror = (error) => {
                        console.error('Error reading image file:', error);
                        alert('Failed to load image. Please try again.');
                    };
                    reader.readAsDataURL(file);
                } else {
                    // Hide preview if no file selected
                    const preview = document.getElementById('aiVideoImagePreview');
                    if (preview) {
                        preview.style.display = 'none';
                    }
                    aiVideoInputImageData = null;
                }
            });

            // Cancel button
            aiVideoCancel.addEventListener('click', closeAIVideoModal);

            // OK button - save config and finalize element
            aiVideoOk.addEventListener('click', () => {
                const prompt = aiVideoPrompt.value.trim();
                if (!prompt) {
                    alert('Please enter a prompt');
                    return;
                }

                const config = {
                    prompt: prompt,
                    model: aiVideoModel.value,
                    duration: parseInt(aiVideoDuration.value),
                    inputImageData: aiVideoInputImageData,
                    size: '720x1280' // Fixed for TikTok format
                };

                // Log config for debugging
                console.log('AI Video config being saved:', {
                    prompt: config.prompt,
                    model: config.model,
                    duration: config.duration,
                    size: config.size,
                    hasInputImage: !!config.inputImageData,
                    inputImageLength: config.inputImageData ? config.inputImageData.length : 0
                });

                // Store config in element
                if (currentAIVideoElement) {
                    currentAIVideoElement.dataset.aiVideoConfig = JSON.stringify(config);
                    currentAIVideoElement.dataset.duration = config.duration;
                    
                    // Update element width to match duration
                    updateElementWidth(currentAIVideoElement);
                    
                    // Finalize element
                    const elementId = currentAIVideoElement.dataset.elementId;
                    finalizeElement(currentAIVideoElement, 'ai-video', elementId);
                    
                    // Update ruler
                    initializeTimelineRuler();
                }

                closeAIVideoModal();
            });

            // Close on overlay click
            aiVideoModal.addEventListener('click', (e) => {
                if (e.target === aiVideoModal) {
                    closeAIVideoModal();
                }
            });

            // ===== AI IMAGE MODAL EVENT LISTENERS =====

            const aiImageModal = document.getElementById('aiImageModal');
            const aiImagePrompt = document.getElementById('aiImagePrompt');
            const aiImageModel = document.getElementById('aiImageModel');
            const aiImageQuality = document.getElementById('aiImageQuality');
            const aiImageFormat = document.getElementById('aiImageFormat');
            const aiImageCompression = document.getElementById('aiImageCompression');
            const aiImageCancel = document.getElementById('aiImageCancel');
            const aiImageOk = document.getElementById('aiImageOk');

            // Update compression visibility when format changes
            aiImageFormat.addEventListener('change', updateCompressionVisibility);

            // Cancel button
            aiImageCancel.addEventListener('click', closeAIImageModal);

            // OK button - save config and finalize element
            aiImageOk.addEventListener('click', () => {
                const prompt = aiImagePrompt.value.trim();
                if (!prompt) {
                    alert('Please enter a prompt');
                    return;
                }

                const config = {
                    prompt: prompt,
                    model: aiImageModel.value,
                    quality: aiImageQuality.value,
                    size: '1024x1536', // Portrait mode (9:16 aspect ratio)
                    format: aiImageFormat.value
                };

                // Add compression only for JPEG and WebP
                if (config.format === 'jpeg' || config.format === 'webp') {
                    config.output_compression = parseInt(aiImageCompression.value);
                }

                // Store config in element
                if (currentAIImageElement) {
                    currentAIImageElement.dataset.aiImageConfig = JSON.stringify(config);

                    // Finalize element
                    const elementId = currentAIImageElement.dataset.elementId;
                    finalizeElement(currentAIImageElement, 'ai-image', elementId);

                    // Update ruler
                    initializeTimelineRuler();
                }

                closeAIImageModal();
            });

            // Close on overlay click
            aiImageModal.addEventListener('click', (e) => {
                if (e.target === aiImageModal) {
                    closeAIImageModal();
                }
            });

            // ===== EXPORT FUNCTIONALITY =====

            const exportButton = document.getElementById('exportButton');
            const exportButtonInline = document.getElementById('exportButtonInline');
            const exportModal = document.getElementById('exportModal');
            const exportModalCancel = document.getElementById('exportModalCancel');
            const exportModalCreate = document.getElementById('exportModalCreate');
            const exportModalContent = document.getElementById('exportModalContent');
            const exportProgress = document.getElementById('exportProgress');
            const variationCount = document.getElementById('variationCount');
            const variationDetails = document.getElementById('variationDetails');
            const videoCount = document.getElementById('videoCount');

            // Check if all elements exist
            if (!exportButton || !exportModal) {
                console.error('Export button or modal not found!', {
                    exportButton: !!exportButton,
                    exportModal: !!exportModal
                });
            } else {
                console.log('Export elements found, attaching listeners');

                // Calculate possible variations based on pools and AI elements
                function calculateVariations() {
                    const elementsRow = document.getElementById('elementsRow');
                    if (!elementsRow) return { totalVariations: 1, hasAI: false, poolCounts: [], poolNames: [] };
                    
                    const timelineElements = Array.from(elementsRow.querySelectorAll('.timeline-element')).filter(el => {
                        // Must be finalized and have a valid type
                        const isFinalized = el.dataset.finalized === 'true';
                        const hasType = el.dataset.type && el.dataset.type !== 'none';
                        return isFinalized && hasType;
                    });

                    let totalVariations = 1;
                    let hasAI = false;
                    let poolCounts = [];
                    let poolNames = [];

                    console.log(`Calculating variations from ${timelineElements.length} elements`);

                    timelineElements.forEach(el => {
                        const type = el.dataset.type;
                        console.log(`Element type: ${type}`);

                        if (type === 'ai' || type === 'ai-video' || type === 'ai-image') {
                            hasAI = true;
                            console.log('Found AI element:', type);
                        } else if (type === 'pool') {
                            try {
                                const poolData = JSON.parse(el.dataset.poolData || '{}');
                                // Pool structure: { name: "...", files: [...] }
                                const poolName = poolData.name || 'Unnamed Pool';
                                const files = poolData.files || [];
                                console.log(`Pool "${poolName}" has ${files.length} items`);
                                if (files.length > 0) {
                                    totalVariations *= files.length;
                                    poolCounts.push(files.length);
                                    poolNames.push(poolName);
                                }
                            } catch (e) {
                                console.warn('Failed to parse pool data:', e, el.dataset.poolData);
                            }
                        }
                    });

                    console.log('Variation calculation result:', { totalVariations, hasAI, poolCounts, poolNames });
                    return { totalVariations, hasAI, poolCounts, poolNames };
                }

                // Open export modal
                exportButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Export button clicked!');
                    
                    try {
                        const variations = calculateVariations();
                        console.log('Variations calculated:', variations);
                        
                        if (!variationCount || !variationDetails || !videoCount) {
                            console.error('Modal elements not found!');
                            return;
                        }
                        
                        if (variations.hasAI) {
                            variationCount.textContent = '∞';
                            variationCount.classList.add('infinite');
                            variationDetails.textContent = 'Infinite variations possible with AI-generated content';
                            videoCount.max = 100; // Allow more for AI
                        } else {
                            variationCount.textContent = variations.totalVariations.toLocaleString();
                            variationCount.classList.remove('infinite');
                            
                            if (variations.poolCounts.length > 0) {
                                const poolInfo = variations.poolNames.map((name, idx) => 
                                    `${name} (${variations.poolCounts[idx]} items)`
                                ).join(' × ');
                                variationDetails.innerHTML = `${poolInfo}<br><strong>${variations.totalVariations.toLocaleString()}</strong> unique combinations`;
                            } else {
                                variationDetails.textContent = 'Single video with current configuration';
                            }
                            
                            // Limit to available variations
                            videoCount.max = Math.min(variations.totalVariations, 10);
                        }
                        
                        videoCount.value = 1;
                        
                        // Use 'open' class instead of 'active' to match other modals
                        exportModal.classList.add('open');
                        if (exportModalContent) {
                            exportModalContent.style.display = 'block';
                        }
                        if (exportProgress) {
                            exportProgress.classList.remove('active');
                        }
                        
                        console.log('Export modal opened');
                    } catch (error) {
                        console.error('Error opening export modal:', error);
                        alert('Error opening export modal. Please check the console.');
                    }
                });

                // Wire up inline export button to same handler
                if (exportButtonInline) {
                    exportButtonInline.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('Inline export button clicked!');
                        
                        try {
                            const variations = calculateVariations();
                            console.log('Variations calculated:', variations);
                            
                            if (!variationCount || !variationDetails || !videoCount) {
                                console.error('Modal elements not found!');
                                return;
                            }
                            
                            if (variations.hasAI) {
                                variationCount.textContent = '∞';
                                variationCount.classList.add('infinite');
                                variationDetails.textContent = 'Infinite variations possible with AI-generated content';
                                videoCount.max = 100; // Allow more for AI
                            } else {
                                variationCount.textContent = variations.totalVariations.toLocaleString();
                                variationCount.classList.remove('infinite');
                                
                                if (variations.poolCounts.length > 0) {
                                    const poolInfo = variations.poolNames.map((name, idx) => 
                                        `${name} (${variations.poolCounts[idx]} items)`
                                    ).join(' × ');
                                    variationDetails.innerHTML = `${poolInfo}<br><strong>${variations.totalVariations.toLocaleString()}</strong> unique combinations`;
                                } else {
                                    variationDetails.textContent = 'Single video with current configuration';
                                }
                                
                                // Limit to available variations
                                videoCount.max = Math.min(variations.totalVariations, 10);
                            }
                            
                            videoCount.value = 1;
                            
                            // Use 'open' class instead of 'active' to match other modals
                            exportModal.classList.add('open');

                            updateExportBadge();

                            // Determine which view to show
                            const hasGenerating = videoQueue.videos.some(v =>
                                v.status === 'pending' || v.status === 'processing'
                            );

                            const generatingSection = document.getElementById('exportGeneratingSection');
                            const statusLink = document.getElementById('exportViewStatusLink');

                            if (hasGenerating) {
                                // Show ONLY generating section (currently generating)
                                if (exportModalContent) exportModalContent.style.display = 'none';
                                if (generatingSection) generatingSection.style.display = 'flex';
                                if (statusLink) statusLink.style.display = 'none'; // Hide status link when in generating view
                            } else {
                                // Show form (no active generation)
                                if (exportModalContent) exportModalContent.style.display = 'block';
                                if (generatingSection) generatingSection.style.display = 'none';
                                updateStatusLink(); // Update and show status link in header
                            }

                            if (exportProgress) {
                                exportProgress.classList.remove('active');
                            }

                            console.log('Export modal opened');
                        } catch (error) {
                            console.error('Error opening export modal:', error);
                            alert('Error opening export modal. Please check the console.');
                        }
                    });
                }

                // Close export modal
                if (exportModalCancel) {
                    exportModalCancel.addEventListener('click', () => {
                        exportModal.classList.remove('open');
                        console.log('Export modal closed');
                    });
                }

                exportModal.addEventListener('click', (e) => {
                    if (e.target === exportModal) {
                        exportModal.classList.remove('open');
                    }
                });

                // Compress image to reduce payload size
                async function compressImage(dataUrl, maxWidth = 1920, quality = 0.7) {
                    return new Promise((resolve) => {
                        if (!dataUrl || !dataUrl.startsWith('data:image')) {
                            resolve(dataUrl);
                            return;
                        }

                        const img = new Image();
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            let width = img.width;
                            let height = img.height;

                            if (width > maxWidth) {
                                height = (height * maxWidth) / width;
                                width = maxWidth;
                            }

                            canvas.width = width;
                            canvas.height = height;

                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, width, height);

                            resolve(canvas.toDataURL('image/jpeg', quality));
                        };
                        img.onerror = () => resolve(dataUrl);
                        img.src = dataUrl;
                    });
                }

                // Collect timeline data for export
                async function collectTimelineData() {
                    const elementsRow = document.getElementById('elementsRow');
                    const editTrack = document.getElementById('editTrack');
                    
                    const timelineElements = Array.from(elementsRow.querySelectorAll('.timeline-element')).filter(el => {
                        // Must be finalized and have a valid type
                        const isFinalized = el.dataset.finalized === 'true';
                        const hasType = el.dataset.type && el.dataset.type !== 'none';
                        return isFinalized && hasType;
                    });

                    // Sort by visual position
                    timelineElements.sort((a, b) => {
                        return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
                    });

                    const elements = await Promise.all(timelineElements.map(async (el) => {
                        const type = el.dataset.type;
                        let mediaUrl = null;
                        
                        // Get media URL based on type
                        if (type === 'video') {
                            // Convert video File to base64 data URL for export
                            if (el._videoFile) {
                                console.log('Converting video file to base64...');
                                mediaUrl = await new Promise((resolve) => {
                                    const reader = new FileReader();
                                    reader.onload = (e) => resolve(e.target.result);
                                    reader.onerror = () => resolve(null);
                                    reader.readAsDataURL(el._videoFile);
                                });
                            } else {
                                mediaUrl = el.dataset.videoURL || null;
                            }
                        } else if (type === 'image') {
                            const rawImageData = el.dataset.imageData || null;
                            mediaUrl = await compressImage(rawImageData);
                        } else if (type === 'pool') {
                            // Pool mediaUrl will be selected from poolData by backend
                            mediaUrl = null;
                        } else if (type === 'ai-video') {
                            // AI Video will be generated during export
                            mediaUrl = null;
                        } else if (type === 'ai-image') {
                            // AI Image will be generated during export
                            mediaUrl = null;
                        }

                        let poolData = el.dataset.poolData ? JSON.parse(el.dataset.poolData) : null;
                        const aiVideoConfig = el.dataset.aiVideoConfig ? JSON.parse(el.dataset.aiVideoConfig) : null;
                        const aiImageConfig = el.dataset.aiImageConfig ? JSON.parse(el.dataset.aiImageConfig) : null;

                        if (poolData && poolData.files) {
                            poolData.files = await Promise.all(poolData.files.map(async (file) => {
                                if (file.data && file.type && file.type.startsWith('image/')) {
                                    return { ...file, data: await compressImage(file.data) };
                                }
                                return file;
                            }));
                        }

                        const data = {
                            type: type,
                            duration: parseInt(el.dataset.duration) || 5,
                            mediaUrl: mediaUrl,
                            poolData: poolData,
                            poolName: el.dataset.poolName || null,
                            aiVideoConfig: aiVideoConfig, // Include AI Video config
                            aiImageConfig: aiImageConfig, // Include AI Image config
                            shouldLoop: el.dataset.shouldLoop === 'true',
                            videoStartTime: parseFloat(el.dataset.videoStartTime) || 0
                        };
                        
                        // Debug logging for pools
                        if (type === 'pool' && poolData) {
                            console.log('Pool element collected:', {
                                name: poolData.name,
                                filesCount: poolData.files ? poolData.files.length : 0,
                                hasFiles: !!poolData.files,
                                firstFile: poolData.files && poolData.files[0] ? {
                                    name: poolData.files[0].name,
                                    type: poolData.files[0].type,
                                    hasData: !!poolData.files[0].data,
                                    dataLength: poolData.files[0].data ? poolData.files[0].data.length : 0
                                } : null
                            });
                        } else {
                            console.log('Collected element:', data);
                        }
                        
                        return data;
                    }));
                    
                    console.log('Total elements collected:', elements.length);

                    // Get edit elements (overlays)
                    const editElements = Array.from(editTrack.querySelectorAll('.edit-element[data-finalized="true"]'));
                    
                    // Build timeline positions for elements
                    const timelinePositions = [];
                    let cumulativeTime = 0;
                    timelineElements.forEach(el => {
                        const duration = parseInt(el.dataset.duration) || 5;
                        const left = el.getBoundingClientRect().left;
                        timelinePositions.push({
                            left: left,
                            startTime: cumulativeTime,
                            endTime: cumulativeTime + duration,
                            duration: duration
                        });
                        cumulativeTime += duration;
                    });

                    const overlays = (await Promise.all(editElements.map(async (editEl) => {
                        const editLeft = editEl.getBoundingClientRect().left;
                        const editDuration = parseInt(editEl.dataset.duration) || 5;
                        const overlayUrl = editEl.dataset.overlayUrl;

                        if (!overlayUrl) return null;

                        // Calculate the edit's start time based on its position
                        let editStartTime = 0;

                        for (let i = 0; i < timelinePositions.length; i++) {
                            const pos = timelinePositions[i];

                            if (i === timelinePositions.length - 1) {
                                const offsetPixels = editLeft - pos.left;
                                const offsetSeconds = offsetPixels / PIXEL_PER_SECOND;
                                editStartTime = pos.startTime + Math.max(0, offsetSeconds);
                                break;
                            } else {
                                const nextPos = timelinePositions[i + 1];
                                if (editLeft >= pos.left && editLeft < nextPos.left) {
                                    const offsetPixels = editLeft - pos.left;
                                    const offsetSeconds = offsetPixels / PIXEL_PER_SECOND;
                                    editStartTime = pos.startTime + Math.max(0, offsetSeconds);
                                    break;
                                }
                            }
                        }

                        const compressedOverlay = await compressImage(overlayUrl, 1920, 0.8);

                        return {
                            overlayUrl: compressedOverlay,
                            startTime: editStartTime,
                            duration: editDuration
                        };
                    }))).filter(o => o !== null);

                    return {
                        elements: elements,
                        overlays: overlays,
                        variablePools: variablePools,  // Include variable pools
                        totalDuration: cumulativeTime
                    };
                }

                // Helper function to get pool item for variation index
                function getPoolItemForIndex(poolData, variationIndex) {
                    if (!poolData || !poolData.files || poolData.files.length === 0) return null;
                    const poolIndex = variationIndex % poolData.files.length;
                    return poolData.files[poolIndex];
                }

                // Helper function to extract video frame at specific time
                async function extractVideoFrame(videoDataUrl, timestamp) {
                    return new Promise((resolve) => {
                        const video = document.createElement('video');
                        video.muted = true;
                        video.crossOrigin = 'anonymous';

                        video.addEventListener('loadedmetadata', () => {
                            // Ensure timestamp is within video duration
                            const seekTime = Math.min(timestamp, video.duration - 0.1);

                            const seekHandler = () => {
                                const canvas = document.createElement('canvas');
                                canvas.width = 200;
                                canvas.height = 356; // 9:16 aspect ratio
                                const ctx = canvas.getContext('2d');

                                // Calculate dimensions to fill canvas while maintaining aspect ratio
                                const videoAspect = video.videoWidth / video.videoHeight;
                                const canvasAspect = canvas.width / canvas.height;

                                let drawWidth, drawHeight, offsetX, offsetY;

                                if (videoAspect > canvasAspect) {
                                    drawHeight = canvas.height;
                                    drawWidth = drawHeight * videoAspect;
                                    offsetX = (canvas.width - drawWidth) / 2;
                                    offsetY = 0;
                                } else {
                                    drawWidth = canvas.width;
                                    drawHeight = drawWidth / videoAspect;
                                    offsetX = 0;
                                    offsetY = (canvas.height - drawHeight) / 2;
                                }

                                ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
                                resolve(canvas.toDataURL('image/jpeg', 0.7));
                            };

                            video.addEventListener('seeked', seekHandler, { once: true });
                            video.currentTime = seekTime;
                        });

                        video.addEventListener('error', () => resolve(null));
                        video.src = videoDataUrl;
                    });
                }

                // Helper function to create video card with timeline preview
                async function createVideoCard(index, timelineData) {
                    const card = document.createElement('div');
                    card.className = 'export-video-card pending';
                    card.dataset.videoIndex = index;

                    // Video number badge with play icon
                    const numberBadge = document.createElement('div');
                    numberBadge.className = 'export-video-number';

                    const numberText = document.createElement('span');
                    numberText.className = 'number-text';
                    numberText.textContent = index + 1;

                    // Use simple text-based play icon instead of SVG for reliability
                    const playIcon = document.createElement('span');
                    playIcon.className = 'play-icon';
                    playIcon.textContent = '▶';
                    playIcon.style.fontSize = '12px';
                    playIcon.style.lineHeight = '1';
                    playIcon.style.color = 'white';

                    numberBadge.appendChild(numberText);
                    numberBadge.appendChild(playIcon);

                    // Timeline preview
                    const timeline = document.createElement('div');
                    timeline.className = 'export-video-timeline';

                    // Create simplified element previews with actual pool selections
                    if (timelineData.elements && timelineData.elements.length > 0) {
                        for (const element of timelineData.elements) {
                            const elementDiv = document.createElement('div');
                            elementDiv.className = 'export-video-element';

                            // Calculate width based on duration (40px per second, min 70px)
                            const widthPx = Math.max(70, element.duration * 40);
                            elementDiv.style.width = `${widthPx}px`;

                            const type = element.type;

                            if (type === 'text' || type === 'ai-video' || type === 'ai-image') {
                                elementDiv.classList.add('text-element');
                                if (type === 'ai-video') {
                                    elementDiv.textContent = 'AI Video';
                                } else if (type === 'ai-image') {
                                    elementDiv.textContent = 'AI Image';
                                } else {
                                    elementDiv.textContent = 'Text';
                                }
                            } else if (type === 'video') {
                                // Extract multiple frames every 5 seconds for videos
                                if (element.mediaUrl) {
                                    const duration = element.duration || 5;
                                    const frameInterval = 5; // Frame every 5 seconds
                                    const numFrames = Math.ceil(duration / frameInterval);

                                    // Calculate total width based on duration (40px per second, min 70px)
                                    const totalWidth = Math.max(70, duration * 40);
                                    const frameWidth = totalWidth / numFrames;

                                    // Create individual frame elements side-by-side
                                    for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
                                        const timestamp = frameIdx * frameInterval + 2.5; // Offset to middle of each 5s segment
                                        const frameDiv = document.createElement('div');
                                        frameDiv.className = 'export-video-element video-element';
                                        frameDiv.style.width = `${frameWidth}px`; // Proportional width
                                        frameDiv.style.flexShrink = '0';

                                        const frameUrl = await extractVideoFrame(element.mediaUrl, timestamp);
                                        if (frameUrl) {
                                            frameDiv.style.backgroundImage = `url(${frameUrl})`;
                                        }

                                        timeline.appendChild(frameDiv);
                                    }
                                    continue; // Skip the normal timeline.appendChild(elementDiv) at the end
                                }
                            } else if (type === 'image') {
                                elementDiv.classList.add('image-element');
                                // Direct image element
                                if (element.mediaUrl) {
                                    elementDiv.style.backgroundImage = `url(${element.mediaUrl})`;
                                }
                            } else if (type === 'pool') {
                                // Pool element - get the specific file for this variation
                                const poolData = element.poolData;
                                if (poolData && poolData.files && poolData.files.length > 0) {
                                    const poolItem = getPoolItemForIndex(poolData, index);

                                    if (poolItem) {
                                        // Determine if it's a video or image pool
                                        const isVideo = poolItem.type && poolItem.type.startsWith('video/');
                                        elementDiv.classList.add(isVideo ? 'video-element' : 'image-element');

                                        // For videos, extract multiple frames every 5 seconds
                                        if (poolItem.data && isVideo) {
                                            const duration = element.duration || 5;
                                            const frameInterval = 5;
                                            const numFrames = Math.ceil(duration / frameInterval);

                                            // Calculate total width based on duration (40px per second, min 70px)
                                            const totalWidth = Math.max(70, duration * 40);
                                            const frameWidth = totalWidth / numFrames;

                                            for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
                                                const timestamp = frameIdx * frameInterval + 2.5;
                                                const frameDiv = document.createElement('div');
                                                frameDiv.className = 'export-video-element video-element';
                                                frameDiv.style.width = `${frameWidth}px`; // Proportional width
                                                frameDiv.style.flexShrink = '0';

                                                const frameUrl = await extractVideoFrame(poolItem.data, timestamp);
                                                if (frameUrl) {
                                                    frameDiv.style.backgroundImage = `url(${frameUrl})`;
                                                }

                                                timeline.appendChild(frameDiv);
                                            }
                                            continue; // Skip normal append
                                        } else if (poolItem.data) {
                                            // For images, use directly
                                            elementDiv.style.backgroundImage = `url(${poolItem.data})`;
                                        }
                                    }
                                }
                            }

                            timeline.appendChild(elementDiv);
                        }
                    }

                    // Actions container
                    const actions = document.createElement('div');
                    actions.className = 'export-video-actions';

                    // Download button (hidden until completed)
                    const downloadBtn = document.createElement('button');
                    downloadBtn.className = 'export-video-download';
                    downloadBtn.textContent = 'Download';
                    downloadBtn.dataset.videoUrl = '';

                    actions.appendChild(downloadBtn);

                    card.appendChild(numberBadge);
                    card.appendChild(timeline);
                    card.appendChild(actions);

                    return card;
                }

                // Helper function to update AI element thumbnails
                async function updateAIThumbnails(cardIndex, aiContent) {
                    if (!aiContent || Object.keys(aiContent).length === 0) return;

                    const card = document.querySelector(`.export-video-card[data-video-index="${cardIndex}"]`);
                    if (!card) return;

                    const timeline = card.querySelector('.export-video-timeline');
                    if (!timeline) return;

                    // Update each AI element
                    for (const [key, contentUrl] of Object.entries(aiContent)) {
                        const match = key.match(/(ai_video|ai_image)_(\d+)/);
                        if (!match) continue;

                        const [, contentType, elemIndex] = match;
                        const elements = timeline.querySelectorAll('.export-video-element');
                        const targetElement = elements[parseInt(elemIndex)];

                        if (!targetElement) continue;

                        if (contentType === 'ai_video') {
                            // Extract frame from AI-generated video
                            const frameUrl = await extractVideoFrame(contentUrl, 2.5);
                            if (frameUrl) {
                                targetElement.style.backgroundImage = `url(${frameUrl})`;
                            }
                        } else if (contentType === 'ai_image') {
                            // Use the AI-generated image directly
                            targetElement.style.backgroundImage = `url(${contentUrl})`;
                        }
                    }
                }

                // Helper function to update video card state by videoId
                async function updateVideoCardState(videoId, state, videoUrl = null, aiContent = null) {
                    const card = document.querySelector(`[data-video-id="${videoId}"]`);
                    if (!card) {
                        console.warn(`Card not found for videoId ${videoId}`);
                        return;
                    }

                    const downloadBtn = card.querySelector('.export-video-download');

                    // Remove all state classes
                    card.classList.remove('pending', 'processing', 'completed');

                    // Add new state
                    card.classList.add(state);

                    if (state === 'completed' && videoUrl && downloadBtn) {
                        downloadBtn.dataset.videoUrl = videoUrl;
                        downloadBtn.addEventListener('click', () => {
                            const link = document.createElement('a');
                            link.href = videoUrl;
                            link.download = `video_${videoId + 1}.mp4`;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                        });

                        // Update thumbnails to show actual exported video frames
                        const timeline = card.querySelector('.export-video-timeline');
                        if (timeline) {
                            // Get all frame divs
                            const frames = timeline.querySelectorAll('.timeline-frame');
                            const numFrames = frames.length;

                            // Extract frames from the actual exported video
                            for (let i = 0; i < numFrames; i++) {
                                const frameTime = (i * 5) + 2.5; // Same logic as before
                                try {
                                    const frameUrl = await extractVideoFrame(videoUrl, frameTime);
                                    frames[i].style.backgroundImage = `url(${frameUrl})`;
                                } catch (err) {
                                    console.warn('Failed to extract frame:', err);
                                }
                            }
                        }

                        // Update AI thumbnails if available
                        if (aiContent) {
                            const videoIndex = card.dataset.videoIndex;
                            if (videoIndex !== undefined) {
                                updateAIThumbnails(parseInt(videoIndex), aiContent);
                            }
                        }
                    }
                }

                // ========== VIDEO QUEUE SYSTEM ==========

                // Video queue state (persists across modal open/close)
                const videoQueue = {
                    videos: [], // { id, status: 'pending'|'processing'|'ready', videoUrl, aiContent, timelineData }
                    nextId: 0
                };

                function updateExportBadge() {
                    const badge = document.getElementById('exportBadge');
                    if (!badge) return;

                    const readyCount = videoQueue.videos.filter(v => v.status === 'ready').length;
                    const hasGenerating = videoQueue.videos.some(v => v.status === 'pending' || v.status === 'processing');

                    if (readyCount > 0) {
                        // Show number badge
                        badge.textContent = readyCount;
                        badge.classList.remove('generating');
                        badge.style.display = 'flex';
                    } else if (hasGenerating) {
                        // Show empty circle badge
                        badge.textContent = '';
                        badge.classList.add('generating');
                        badge.style.display = 'flex';
                    } else {
                        // Hide badge
                        badge.style.display = 'none';
                    }
                }

                function updateStatusLink() {
                    const statusLink = document.getElementById('exportViewStatusLink');
                    if (!statusLink) return;

                    // SIMPLE CHECK: Is generating section visible?
                    const generatingSection = document.getElementById('exportGeneratingSection');
                    const generatingDisplay = generatingSection ? window.getComputedStyle(generatingSection).display : 'none';
                    
                    // If generating section is visible, hide the button
                    if (generatingDisplay === 'flex') {
                        statusLink.style.display = 'none';
                        return;
                    }

                    // Otherwise, show button if there are videos
                    const readyCount = videoQueue.videos.filter(v => v.status === 'ready').length;
                    const generatingCount = videoQueue.videos.filter(v => v.status === 'pending' || v.status === 'processing').length;

                    if (readyCount > 0) {
                        statusLink.textContent = `${readyCount} video${readyCount > 1 ? 's' : ''} ready to download`;
                        statusLink.style.display = 'flex';
                    } else if (generatingCount > 0) {
                        statusLink.textContent = `${generatingCount} video${generatingCount > 1 ? 's' : ''} in progress`;
                        statusLink.style.display = 'flex';
                    } else {
                        statusLink.style.display = 'none';
                    }
                }

                function switchToFormView() {
                    const exportModalContent = document.getElementById('exportModalContent');
                    const generatingSection = document.getElementById('exportGeneratingSection');

                    if (exportModalContent) exportModalContent.style.display = 'block';
                    if (generatingSection) generatingSection.style.display = 'none';

                    // Show status link in header when in form view (if there are videos)
                    updateStatusLink();
                }

                function switchToGeneratingView() {
                    const exportModalContent = document.getElementById('exportModalContent');
                    const generatingSection = document.getElementById('exportGeneratingSection');
                    const statusLink = document.getElementById('exportViewStatusLink');

                    if (exportModalContent) exportModalContent.style.display = 'none';
                    if (generatingSection) generatingSection.style.display = 'flex';

                    // Hide Download All button when in generating view
                    updateDownloadAllButton();
                    
                    // Hide status link
                    updateStatusLink();
                }

                // Navigation link handlers
                const exportViewStatusLink = document.getElementById('exportViewStatusLink');
                const exportGenerateMoreLink = document.getElementById('exportGenerateMoreLink');

                if (exportViewStatusLink) {
                    exportViewStatusLink.addEventListener('click', () => {
                        switchToGeneratingView();
                    });
                }

                if (exportGenerateMoreLink) {
                    exportGenerateMoreLink.addEventListener('click', () => {
                        switchToFormView();
                    });
                }

                function addVideosToQueue(count, timelineData) {
                    for (let i = 0; i < count; i++) {
                        videoQueue.videos.push({
                            id: videoQueue.nextId++,
                            status: 'pending',
                            videoUrl: null,
                            aiContent: null,
                            timelineData: timelineData
                        });
                    }
                    updateExportBadge();
                    updateStatusLink();
                }

                function updateVideoInQueue(id, status, videoUrl = null, aiContent = null) {
                    const video = videoQueue.videos.find(v => v.id === id);
                    if (video) {
                        video.status = status;
                        if (videoUrl) video.videoUrl = videoUrl;
                        if (aiContent) video.aiContent = aiContent;

                        updateExportBadge();
                        updateStatusLink();
                    }
                }

                // Generate videos
                if (exportModalCreate) {
                    exportModalCreate.addEventListener('click', async () => {
                        const count = parseInt(videoCount.value);

                        if (!count || count < 1) {
                            alert('Please enter a valid number of videos');
                            return;
                        }

                        const variations = calculateVariations();
                        if (!variations.hasAI && count > variations.totalVariations) {
                            alert(`You can only generate up to ${variations.totalVariations} variations with the current pool configuration`);
                            return;
                        }

                        console.log('Collecting timeline data...');
                        const timelineData = await collectTimelineData();
                        console.log('Timeline data collected:', timelineData);

                        // Strip out large metadata to reduce payload size
                        // The multiStageAnalysis data can be very large and isn't needed for export
                        if (timelineData.metadata && timelineData.metadata.multiStageAnalysis) {
                            // Keep only the summary, remove the full stage outputs
                            const summary = timelineData.metadata.multiStageAnalysis.summary;
                            timelineData.metadata = {
                                ...timelineData.metadata,
                                multiStageAnalysis: { summary }
                            };
                            console.log('Stripped large multiStageAnalysis data from export payload');
                        }

                        // Switch to generating view IMMEDIATELY
                        switchToGeneratingView();

                        // Add videos to queue (this will update badge)
                        const startId = videoQueue.nextId;
                        for (let i = 0; i < count; i++) {
                            videoQueue.videos.push({
                                id: videoQueue.nextId++,
                                status: 'pending',
                                videoUrl: null,
                                aiContent: null,
                                timelineData: timelineData
                            });
                        }

                        // Create and append video cards in background (don't await)
                        const videosList = document.getElementById('exportVideosList');
                        if (videosList) {
                            for (let i = 0; i < count; i++) {
                                const videoId = startId + i;
                                // Don't await - let cards load in background
                                createVideoCard(i, timelineData).then(card => {
                                    card.dataset.videoId = videoId;
                                    videosList.appendChild(card);
                                });
                            }
                        }

                        // Start generation in background
                        try {
                            // Send to backend
                            const response = await fetch((window.API_BASE_URL || '') + '/api/creator/export/', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                    timeline: timelineData,
                                    videoCount: count
                                })
                            });

                            if (!response.ok) {
                                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                                throw new Error(errorData.error || 'Failed to generate videos');
                            }

                            const result = await response.json();

                            // Process each video with visual feedback
                            if (result.videos && result.videos.length > 0) {
                                const results = result.results || [];

                                for (let i = 0; i < result.videos.length; i++) {
                                    const videoId = startId + i;

                                    // Mark as processing
                                    updateVideoInQueue(videoId, 'processing');
                                    updateVideoCardState(videoId, 'processing');

                                    // Simulate processing time for visual effect
                                    await new Promise(resolve => setTimeout(resolve, 500));

                                    const videoUrl = result.videos[i];
                                    const aiContent = results[i] ? results[i].aiContent : null;

                                    // Mark as ready and update thumbnails
                                    updateVideoInQueue(videoId, 'ready', videoUrl, aiContent);
                                    await updateVideoCardState(videoId, 'completed', videoUrl, aiContent);
                                }

                                // DON'T auto-switch views - stay in generating view
                                // Just update the badge so user knows videos are ready
                                updateExportBadge();
                                updateDownloadAllButton();
                                // Ensure status link stays hidden in generating view
                                updateStatusLink();
                            } else {
                                throw new Error('No videos were generated');
                            }

                        } catch (error) {
                            console.error('Export error:', error);
                            alert('Failed to generate videos: ' + error.message);

                            // Mark all videos as failed and remove from queue
                            for (let i = 0; i < count; i++) {
                                const videoId = startId + i;
                                const video = videoQueue.videos.find(v => v.id === videoId);
                                if (video) {
                                    videoQueue.videos = videoQueue.videos.filter(v => v.id !== videoId);
                                }
                                // Also remove the card from UI
                                const card = document.querySelector(`[data-video-id="${videoId}"]`);
                                if (card) card.remove();
                            }

                            // DON'T auto-switch - just update badge
                            updateExportBadge();
                        }
                    });
                } else {
                    console.error('Export create button not found!');
                }

                // ========== DOWNLOAD ALL FUNCTIONALITY ==========

                function updateDownloadAllButton() {
                    const downloadAllBtn = document.getElementById('exportDownloadAll');
                    if (!downloadAllBtn) return;

                    // Check if we're in the generating section
                    const generatingSection = document.getElementById('exportGeneratingSection');
                    const isGeneratingView = generatingSection && window.getComputedStyle(generatingSection).display === 'flex';

                    // Only show button in generating view when videos are ready
                    if (isGeneratingView) {
                        const readyVideos = videoQueue.videos.filter(v => v.status === 'ready');
                        if (readyVideos.length > 0) {
                            downloadAllBtn.style.display = 'flex';
                            downloadAllBtn.style.visibility = 'visible';
                        } else {
                            downloadAllBtn.style.display = 'none';
                            downloadAllBtn.style.visibility = 'hidden';
                        }
                    } else {
                        // Hide when not in generating view
                        downloadAllBtn.style.display = 'none';
                        downloadAllBtn.style.visibility = 'hidden';
                    }
                }

                const downloadAllBtn = document.getElementById('exportDownloadAll');
                if (downloadAllBtn) {
                    downloadAllBtn.addEventListener('click', async () => {
                        const readyVideos = videoQueue.videos.filter(v => v.status === 'ready');

                        if (readyVideos.length === 0) {
                            alert('No videos ready to download');
                            return;
                        }

                        downloadAllBtn.disabled = true;
                        downloadAllBtn.textContent = 'Preparing...';

                        try {
                            const zip = new JSZip();
                            const videosFolder = zip.folder('videos');
                            const aiFolder = zip.folder('AI_content');

                            // Download all videos and AI content
                            for (let i = 0; i < readyVideos.length; i++) {
                                const video = readyVideos[i];

                                // Download main video
                                const videoResponse = await fetch(video.videoUrl);
                                const videoBlob = await videoResponse.blob();
                                videosFolder.file(`video_${video.id + 1}.mp4`, videoBlob);

                                // Download AI content if exists
                                if (video.aiContent) {
                                    for (const [key, url] of Object.entries(video.aiContent)) {
                                        try {
                                            const aiResponse = await fetch(url);
                                            const aiBlob = await aiResponse.blob();
                                            const extension = url.includes('.mp4') ? 'mp4' : 'jpg';
                                            aiFolder.file(`video_${video.id + 1}_${key}.${extension}`, aiBlob);
                                        } catch (err) {
                                            console.warn(`Failed to download AI content: ${key}`, err);
                                        }
                                    }
                                }
                            }

                            // Generate and download zip
                            const zipBlob = await zip.generateAsync({ type: 'blob' });
                            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
                            saveAs(zipBlob, `beampage_videos_${timestamp}.zip`);

                            downloadAllBtn.disabled = false;
                            downloadAllBtn.innerHTML = `
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2z"/>
                                    <path d="M13 12.67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/>
                                </svg>
                                Download All
                            `;

                        } catch (error) {
                            console.error('Download all error:', error);
                            alert('Failed to create download: ' + error.message);
                            downloadAllBtn.disabled = false;
                            downloadAllBtn.innerHTML = `
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2z"/>
                                    <path d="M13 12.67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/>
                                </svg>
                                Download All
                            `;
                        }
                    });
                }

                // ========== VIDEO PREVIEW FUNCTIONALITY ==========

                const videoPreviewModal = document.getElementById('videoPreviewModal');
                const videoPreviewPlayer = document.getElementById('videoPreviewPlayer');
                const videoPreviewClose = document.getElementById('videoPreviewClose');

                function openVideoPreview(videoUrl) {
                    if (videoPreviewModal && videoPreviewPlayer) {
                        videoPreviewPlayer.src = videoUrl;
                        videoPreviewModal.classList.add('open');
                        videoPreviewPlayer.play();
                    }
                }

                function closeVideoPreview() {
                    if (videoPreviewModal && videoPreviewPlayer) {
                        videoPreviewModal.classList.remove('open');
                        videoPreviewPlayer.pause();
                        videoPreviewPlayer.src = '';
                    }
                }

                if (videoPreviewClose) {
                    videoPreviewClose.addEventListener('click', closeVideoPreview);
                }

                if (videoPreviewModal) {
                    videoPreviewModal.addEventListener('click', (e) => {
                        if (e.target === videoPreviewModal) {
                            closeVideoPreview();
                        }
                    });
                }

                // Add click handler to completed video badges
                document.addEventListener('click', (e) => {
                    const badge = e.target.closest('.export-video-card.completed .export-video-number');
                    if (badge) {
                        const card = badge.closest('.export-video-card');
                        const downloadBtn = card.querySelector('.export-video-download');
                        if (downloadBtn && downloadBtn.dataset.videoUrl) {
                            openVideoPreview(downloadBtn.dataset.videoUrl);
                        }
                    }
                });

                // ========== INITIALIZE BADGE ON PAGE LOAD ==========
                updateExportBadge();
            }
        });

        // ========== VARIABLE POOL INITIALIZATION ==========
        
        // Load variable pools on page load
        loadVariablePools();

        // Set up variable pool modal event listeners
        const varPoolCreate = document.getElementById('varPoolCreate');
        const varPoolCancel = document.getElementById('varPoolCancel');

        if (varPoolCreate) {
            varPoolCreate.addEventListener('click', createVariablePool);
        }

        if (varPoolCancel) {
            varPoolCancel.addEventListener('click', closeVariablePoolModal);
        }

        // Set up "Add Variable" button event listeners
        const addVariableAIVideo = document.getElementById('addVariableAIVideo');
        const addVariableAIImage = document.getElementById('addVariableAIImage');

        if (addVariableAIVideo) {
            const aiVideoPromptField = document.getElementById('aiVideoPrompt');
            addVariableAIVideo.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showVariableDropdown(aiVideoPromptField, addVariableAIVideo);
            });
        }

        if (addVariableAIImage) {
            const aiImagePromptField = document.getElementById('aiImagePrompt');
            addVariableAIImage.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showVariableDropdown(aiImagePromptField, addVariableAIImage);
            });
        }

        // Add Variable to Edit Text button
        const addVariableEdit = document.getElementById('addVariableEdit');
        if (addVariableEdit) {
            addVariableEdit.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                // Show dropdown to select variable pool
                showVariableDropdownForEdit(addVariableEdit);
            });
        }

        console.log('Variable pool system initialized');

        // ===== PROJECT JSON SERIALIZATION/DESERIALIZATION =====

        /**
         * Serialize the entire timeline to JSON format
         */
        async function serializeProjectToJSON() {
            const elementsRow = document.getElementById('elementsRow');
            const editTrack = document.getElementById('editTrack');

            // Get all finalized timeline elements (excluding the initial "Add Element" button)
            console.log(`[SERIALIZE] Starting serialization - scanning all timeline elements`);

            const allElements = Array.from(elementsRow.querySelectorAll('.timeline-element'));
            console.log(`[SERIALIZE] Found ${allElements.length} total elements in DOM`);
            
            // DEBUG: Log all element IDs and types
            allElements.forEach(el => {
                console.log(`[SERIALIZE DEBUG] Element ${el.dataset.elementId}: type=${el.dataset.type}, finalized=${el.dataset.finalized}, poolData=${!!el.dataset.poolData}, poolId=${el.dataset.poolId}`);
            });

            const timelineElements = allElements.filter(el => {
                const isInitial = el.dataset.elementId === 'initial';
                const isFinalized = el.dataset.finalized === 'true';
                const hasType = el.dataset.type && el.dataset.type !== 'none' && el.dataset.type !== 'undefined';

                // Check if element has content indicators (even if not finalized)
                const hasVideoContent = el._videoFile || el.dataset.videoURL || el.dataset.mediaKey;
                const hasImageContent = el.dataset.imageData || el.dataset.imageFile;
                const hasPoolContent = el.dataset.poolData;
                const hasAIContent = el.dataset.aiVideoConfig || el.dataset.aiImageConfig;
                const hasAnyContent = hasVideoContent || hasImageContent || hasPoolContent || hasAIContent;

                // Infer type from content if type is missing but content exists
                let inferredType = el.dataset.type;
                if (!hasType && hasAnyContent) {
                    if (hasVideoContent) inferredType = 'video';
                    else if (hasImageContent) inferredType = 'image';
                    else if (el.dataset.poolData) {
                        try {
                            const poolData = JSON.parse(el.dataset.poolData);
                            inferredType = 'pool';
                        } catch (e) {}
                    }
                    else if (el.dataset.aiVideoConfig) inferredType = 'ai-video';
                    else if (el.dataset.aiImageConfig) inferredType = 'ai-image';
                }

                // RELAXED INCLUSION LOGIC: Include if NOT initial AND (properly finalized OR has valid content)
                // This prevents elements from being silently dropped due to timing or edit state issues
                const shouldIncludeStrict = !isInitial && isFinalized && hasType;
                const shouldIncludeRelaxed = !isInitial && hasAnyContent && (hasType || inferredType);
                const shouldInclude = shouldIncludeStrict || shouldIncludeRelaxed;

                console.log(`[SERIALIZE FILTER] Element ${el.dataset.elementId}:`);
                console.log(`  - isInitial: ${isInitial}`);
                console.log(`  - type: ${el.dataset.type}`);
                console.log(`  - inferredType: ${inferredType}`);
                console.log(`  - finalized: ${el.dataset.finalized}`);
                console.log(`  - hasType: ${hasType}`);
                console.log(`  - mediaKey: ${el.dataset.mediaKey || 'none'}`);
                console.log(`  - videoFile: ${el.dataset.videoFile || 'none'}`);
                console.log(`  - _videoFile: ${!!el._videoFile}`);
                console.log(`  - hasAnyContent: ${hasAnyContent}`);
                console.log(`  - shouldIncludeStrict: ${shouldIncludeStrict}`);
                console.log(`  - shouldIncludeRelaxed: ${shouldIncludeRelaxed}`);
                console.log(`  - WILL INCLUDE: ${shouldInclude ? 'YES ✓' : 'NO ✗'}`);

                if (!shouldInclude && !isInitial) {
                    console.warn(`[SERIALIZE SKIP] Element ${el.dataset.elementId} SKIPPED - isFinalized=${isFinalized}, hasType=${hasType}`);
                    
                    // CRITICAL WARNING: Element has content but won't be serialized
                    if (hasAnyContent) {
                        console.error(`[SERIALIZE CRITICAL] ⚠️ Element ${el.dataset.elementId} HAS CONTENT but is being SKIPPED!`);
                        console.error(`[SERIALIZE CRITICAL]   This means the element appears in the UI but won't be in the JSON!`);
                        console.error(`[SERIALIZE CRITICAL]   Video: ${hasVideoContent}, Image: ${hasImageContent}, Pool: ${hasPoolContent}, AI: ${hasAIContent}`);
                        console.error(`[SERIALIZE CRITICAL]   Consider this a BUG - element should have been included!`);
                    }
                } else if (shouldIncludeRelaxed && !shouldIncludeStrict) {
                    console.warn(`[SERIALIZE RECOVERY] ✓ Element ${el.dataset.elementId} included via RELAXED filter (has content but finalized=${isFinalized})`);
                }

                // If including via relaxed filter, ensure type is set for serialization
                if (shouldInclude && !hasType && inferredType) {
                    console.log(`[SERIALIZE RECOVERY] Setting inferred type=${inferredType} for ${el.dataset.elementId}`);
                    el.dataset.type = inferredType;
                }

                return shouldInclude;
            });

            console.log(`[SERIALIZE] Will serialize ${timelineElements.length} elements (${allElements.length - timelineElements.length - 1} skipped)`);

            // DON'T sort - preserve DOM order to avoid flipping on reload
            // Elements are already in the correct order in the DOM

            // Serialize elements
            const elements = await Promise.all(timelineElements.map(async (el) => {
                const type = el.dataset.type;
                const duration = parseInt(el.dataset.duration) || 5;

                console.log(`Serializing element: id=${el.dataset.elementId}, type=${type}, duration=${duration}`);
                console.log(`  - finalized: ${el.dataset.finalized}`);
                console.log(`  - hasType: ${!!el.dataset.type && el.dataset.type !== 'none' && el.dataset.type !== 'undefined'}`);

                // Store file references (path or storage location) instead of data
                let mediaReference = null;

                if (type === 'video') {
                    console.log(`Video element: has mediaKey=${!!el.dataset.mediaKey}, has videoFile=${el.dataset.videoFile}`);

                    // Store IndexedDB key reference (Option 4: Hybrid approach)
                    if (el.dataset.mediaKey) {
                        mediaReference = {
                            storage: 'indexeddb',
                            key: el.dataset.mediaKey,
                            filename: el.dataset.videoFile || 'video.mp4',
                            type: 'video'
                        };
                        console.log(`Video reference: IndexedDB key ${el.dataset.mediaKey}`);
                    } else {
                        // Fallback: No IndexedDB key available
                        console.warn('Video element missing IndexedDB key');
                        mediaReference = {
                            storage: 'none',
                            filename: el.dataset.videoFile || 'video.mp4',
                            type: 'video',
                            note: 'File not in IndexedDB - will need re-upload'
                        };
                    }
                } else if (type === 'image') {
                    console.log(`Image element: has mediaKey=${!!el.dataset.mediaKey}, has imageFile=${el.dataset.imageFile}`);

                    // Store IndexedDB key reference (Option 4: Hybrid approach)
                    if (el.dataset.mediaKey) {
                        mediaReference = {
                            storage: 'indexeddb',
                            key: el.dataset.mediaKey,
                            filename: el.dataset.imageFile || 'image.png',
                            type: 'image'
                        };
                        console.log(`Image reference: IndexedDB key ${el.dataset.mediaKey}`);
                    } else {
                        // Fallback: No IndexedDB key available
                        console.warn('Image element missing IndexedDB key');
                        mediaReference = {
                            storage: 'none',
                            filename: el.dataset.imageFile || 'image.png',
                            type: 'image',
                            note: 'File not in IndexedDB - will need re-upload'
                        };
                    }
                }

                const poolData = el.dataset.poolData ? JSON.parse(el.dataset.poolData) : null;

                // For pool elements, store IndexedDB reference (like videos/images)
                let poolReference = null;
                if (poolData) {
                    // Get pool type from multiple possible sources (for backward compatibility)
                    const poolType = poolData.type || el.dataset.poolType || 'video';
                    console.log(`Pool element: name=${poolData.name}, type=${poolType}, id=${poolData.id}, fileCount=${poolData.files ? poolData.files.length : 0}`);
                    
                    if (poolData.id) {
                        // Store IndexedDB reference
                        poolReference = {
                            storage: 'indexeddb',
                            poolId: poolData.id,
                            poolName: poolData.name,
                            poolType: poolType,
                            fileCount: poolData.files ? poolData.files.length : 0
                        };
                        console.log(`Pool reference: IndexedDB ID ${poolData.id}, Type: ${poolType}`);
                    } else {
                        // Fallback: No IndexedDB ID available
                        console.warn(`[SERIALIZE WARNING] Pool element missing IndexedDB ID: ${poolData.name}`);
                        poolReference = {
                            storage: 'none',
                            poolName: poolData.name,
                            poolType: poolType,
                            note: 'Pool not in IndexedDB - will need re-creation'
                        };
                    }
                }

                let cleanAIVideoConfig = null;
                if (el.dataset.aiVideoConfig) {
                    const aiVideoConfig = JSON.parse(el.dataset.aiVideoConfig);
                    // Keep the entire config including inputImageData
                    // User expects reference images to be saved for same-session copy/paste
                    cleanAIVideoConfig = {
                        prompt: aiVideoConfig.prompt,
                        model: aiVideoConfig.model,
                        duration: aiVideoConfig.duration,
                        inputImageData: aiVideoConfig.inputImageData || null
                    };
                }

                const aiImageConfig = el.dataset.aiImageConfig ? JSON.parse(el.dataset.aiImageConfig) : null;

                // Parse videoTrim if exists
                let videoTrim = null;
                if (el.dataset.videoTrim) {
                    try {
                        videoTrim = JSON.parse(el.dataset.videoTrim);
                    } catch (e) {
                        console.warn('Failed to parse videoTrim:', e);
                    }
                }

                return {
                    id: el.dataset.elementId || `elem-${Date.now()}-${Math.random()}`,
                    type: type,
                    duration: duration,
                    mediaReference: mediaReference, // File reference, not data
                    poolReference: poolReference, // IndexedDB pool reference
                    poolName: el.dataset.poolName || (poolData ? poolData.name : null),
                    poolType: el.dataset.poolType || (poolData ? poolData.type : null),
                    aiVideoConfig: cleanAIVideoConfig, // Cleaned AI video config
                    aiImageConfig: aiImageConfig,
                    shouldLoop: el.dataset.shouldLoop === 'true',
                    videoStartTime: parseFloat(el.dataset.videoStartTime) || 0,
                    videoSource: el.dataset.videoSource || null, // For split videos
                    videoTrim: videoTrim // For split videos
                };
            }));

            // Get edit elements (overlays) - excluding the initial "Create Edit" button
            const editElements = Array.from(editTrack.querySelectorAll('.edit-element[data-finalized="true"]')).filter(el => {
                return el.dataset.editId !== 'initial';
            });

            // Build timeline positions for calculating edit start times
            const timelinePositions = [];
            let cumulativeTime = 0;
            timelineElements.forEach(el => {
                const duration = parseInt(el.dataset.duration) || 5;
                const left = el.getBoundingClientRect().left;
                timelinePositions.push({
                    left: left,
                    startTime: cumulativeTime,
                    endTime: cumulativeTime + duration,
                    duration: duration
                });
                cumulativeTime += duration;
            });

            const edits = editElements.map(editEl => {
                const editLeft = editEl.getBoundingClientRect().left;
                const editDuration = parseInt(editEl.dataset.duration) || 5;
                const overlayUrl = editEl.dataset.overlayUrl;

                if (!overlayUrl) return null;

                // Calculate the edit's start time based on its position
                let editStartTime = 0;

                for (let i = 0; i < timelinePositions.length; i++) {
                    const pos = timelinePositions[i];

                    if (i === timelinePositions.length - 1) {
                        const offsetPixels = editLeft - pos.left;
                        const offsetSeconds = offsetPixels / PIXEL_PER_SECOND;
                        editStartTime = pos.startTime + Math.max(0, offsetSeconds);
                        break;
                    } else {
                        const nextPos = timelinePositions[i + 1];
                        if (editLeft >= pos.left && editLeft < nextPos.left) {
                            const offsetPixels = editLeft - pos.left;
                            const offsetSeconds = offsetPixels / PIXEL_PER_SECOND;
                            editStartTime = pos.startTime + Math.max(0, offsetSeconds);
                            break;
                        }
                    }
                }

                return {
                    id: editEl.dataset.editId || `edit-${Date.now()}-${Math.random()}`,
                    overlayUrl: overlayUrl,
                    startTime: editStartTime,
                    duration: editDuration
                };
            }).filter(e => e !== null);

            // Build the complete project JSON
            const projectJSON = {
                version: "1.0",
                canvas: {
                    width: BASE_WIDTH,
                    height: BASE_HEIGHT,
                    aspectRatio: "9:16"
                },
                timeline: {
                    totalDuration: cumulativeTime,
                    elements: elements,
                    edits: edits
                },
                variables: {
                    pools: variablePools.map(pool => ({
                        id: pool.id,
                        name: pool.name,
                        cycleMode: pool.cycleMode,
                        values: pool.values
                    }))
                },
                metadata: {
                    created: new Date().toISOString(),
                    pixelPerSecond: PIXEL_PER_SECOND,
                    maxDuration: MAX_DURATION
                }
            };

            return projectJSON;
        }

        /**
         * Deserialize JSON and rebuild the timeline
         */
        async function deserializeJSONToProject(jsonData) {
            try {
                const project = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

                // Clear existing timeline
                clearTimeline();

                // Restore variable pools
                if (project.variables && project.variables.pools) {
                    variablePools = project.variables.pools.map(pool => ({
                        id: pool.id || nextVariablePoolId++,
                        name: pool.name,
                        cycleMode: pool.cycleMode,
                        values: pool.values || []
                    }));

                    // Update nextVariablePoolId
                    const maxId = Math.max(...variablePools.map(p => p.id), 0);
                    nextVariablePoolId = maxId + 1;
                }

                // Restore timeline elements
                if (project.timeline && project.timeline.elements) {
                    console.log(`Loading ${project.timeline.elements.length} elements from JSON`);
                    for (let i = 0; i < project.timeline.elements.length; i++) {
                        const elemData = project.timeline.elements[i];
                        console.log(`Creating element ${i + 1}/${project.timeline.elements.length}: type=${elemData.type}, duration=${elemData.duration}`);
                        await createElementFromJSON(elemData);
                        console.log(`  ✓ Element ${i + 1} created successfully`);
                    }
                    console.log(`All ${project.timeline.elements.length} elements loaded successfully`);
                }

                // Restore edit elements (overlays)
                if (project.timeline && project.timeline.edits) {
                    for (const editData of project.timeline.edits) {
                        await createEditFromJSON(editData);
                    }
                }

                console.log('Project loaded from JSON successfully');
                return true;
            } catch (error) {
                console.error('Failed to load project from JSON:', error);
                alert('Failed to load project: ' + error.message);
                return false;
            }
        }

        /**
         * Clear the timeline
         */
        function clearTimeline() {
            const elementsRow = document.getElementById('elementsRow');
            const editTrack = document.getElementById('editTrack');

            // Remove all elements except the initial "Add Element" button
            const timelineElements = Array.from(elementsRow.querySelectorAll('.timeline-element'));
            timelineElements.forEach(el => {
                if (el.dataset.elementId !== 'initial') {
                    el.remove();
                }
            });

            // Remove all edits except the initial "Create Edit" button
            const editElements = Array.from(editTrack.querySelectorAll('.edit-element'));
            editElements.forEach(el => {
                if (el.dataset.editId !== 'initial') {
                    el.remove();
                }
            });

            // Ensure the initial "Add Element" button exists
            let initialElement = elementsRow.querySelector('.timeline-element[data-element-id="initial"]');
            if (!initialElement) {
                console.log('Creating missing initial Add Element button');
                initialElement = document.createElement('div');
                initialElement.className = 'timeline-element add-element-btn';
                initialElement.dataset.elementId = 'initial';
                initialElement.dataset.type = 'none';
                initialElement.innerHTML = '<span style="font-size: 24px;">+</span>';
                elementsRow.appendChild(initialElement);
            }

            // Ensure the initial "Create Edit" button exists
            let initialEdit = editTrack.querySelector('.edit-element[data-edit-id="initial"]');
            if (!initialEdit) {
                console.log('Creating missing initial Create Edit button');
                initialEdit = document.createElement('div');
                initialEdit.className = 'edit-element create-edit-btn';
                initialEdit.dataset.editId = 'initial';
                initialEdit.innerHTML = '<span>+ Create Edit</span>';
                editTrack.appendChild(initialEdit);
            }

            // Reset state
            elements = [];
            deletedElements = [];
        }

        /**
         * Create a timeline element from JSON data
         */
        async function createElementFromJSON(elemData) {
            const elementsRow = document.getElementById('elementsRow');

            // Create new element
            const newElement = document.createElement('div');
            newElement.className = 'timeline-element';
            newElement.dataset.elementId = elemData.id || `elem-${nextElementId++}`;
            newElement.dataset.duration = elemData.duration;
            newElement.dataset.type = elemData.type;

            // Set width based on duration
            const width = elemData.duration * PIXEL_PER_SECOND;
            newElement.style.width = `${width}px`;

            // Create the element-content div that finalizeElement expects
            const content = document.createElement('div');
            content.className = 'element-content';
            newElement.appendChild(content);

            // Set type-specific data before finalizing
            if (elemData.type === 'video') {
                const mediaData = elemData.mediaUrl || elemData.mediaReference;

                console.log(`[DESERIALIZE VIDEO] Processing video element ${newElement.dataset.elementId}`);

                if (mediaData && typeof mediaData === 'object' && mediaData.storage === 'indexeddb') {
                    // IndexedDB reference - look up the file
                    console.log(`[DESERIALIZE VIDEO] Looking up IndexedDB key: ${mediaData.key}`);
                    try {
                        const mediaFile = await getMediaFile(mediaData.key);

                        if (mediaFile) {
                            // Found in IndexedDB - restore video and extract frames
                            newElement.dataset.videoURL = mediaFile.dataURL;
                            newElement.dataset.videoFile = mediaFile.filename;
                            newElement.dataset.mediaKey = mediaData.key;
                            console.log(`[DESERIALIZE VIDEO] ✓ Video restored from IndexedDB: ${mediaFile.filename}`);

                            // FIX ISSUE #3: Extract frames with timeout protection
                            console.log(`[DESERIALIZE VIDEO] Starting frame extraction with timeout protection`);
                            try {
                                const video = document.createElement('video');
                                video.src = mediaFile.dataURL;

                                const frameExtractionPromise = new Promise((resolve) => {
                                    video.addEventListener('loadedmetadata', async () => {
                                        console.log(`[DESERIALIZE VIDEO] loadedmetadata fired for ${newElement.dataset.elementId}`);
                                        const duration = elemData.duration || Math.ceil(video.duration);
                                        await extractVideoFrames(video, duration, newElement);
                                        console.log(`[DESERIALIZE VIDEO] ✓ Frame extraction complete`);
                                        resolve(true);
                                    });
                                });

                                const timeoutPromise = new Promise((resolve) => {
                                    setTimeout(() => {
                                        console.warn(`[DESERIALIZE VIDEO] Frame extraction timeout for ${newElement.dataset.elementId}`);
                                        resolve(false);
                                    }, 15000); // 15 second timeout for deserialization
                                });

                                const success = await Promise.race([frameExtractionPromise, timeoutPromise]);
                                if (!success) {
                                    console.warn(`[DESERIALIZE VIDEO] Frame extraction timed out - element will show without frames`);
                                    // Continue anyway - finalizeElement will show empty preview
                                }
                            } catch (frameErr) {
                                console.error(`[DESERIALIZE VIDEO ERROR] Frame extraction error for ${newElement.dataset.elementId}:`, frameErr);
                                // Element is still valid without frames
                            }
                        } else {
                            // Not found in IndexedDB - mark as missing but element is still valid
                            console.warn(`[DESERIALIZE VIDEO] Video not found in IndexedDB: ${mediaData.key}`);
                            newElement.dataset.videoFile = mediaData.filename;
                            newElement.dataset.mediaMissing = 'true';
                            newElement.dataset.mediaKey = mediaData.key;
                            newElement.dataset.elementName = 'VIDEO (missing)';
                        }
                    } catch (lookupErr) {
                        console.error(`[DESERIALIZE VIDEO ERROR] IndexedDB lookup failed for ${mediaData.key}:`, lookupErr);
                        newElement.dataset.videoFile = mediaData.filename || 'video.mp4';
                        newElement.dataset.mediaMissing = 'true';
                        newElement.dataset.errorMessage = lookupErr.message;
                        newElement.dataset.elementName = 'VIDEO (error)';
                    }
                } else if (typeof mediaData === 'string') {
                    // Old format: direct data URL - extract frames
                    // FIX ISSUE #5: Check if it's a revoked blob URL
                    if (mediaData.startsWith('blob:')) {
                        console.warn(`[DESERIALIZE VIDEO ISSUE #5] Blob URL detected - likely revoked: ${mediaData}`);
                        newElement.dataset.mediaMissing = 'true';
                        newElement.dataset.errorMessage = 'Blob URL no longer valid';
                    } else {
                        newElement.dataset.videoURL = mediaData;
                        console.log('[DESERIALIZE VIDEO] Restored from old format (data URL)');

                        // Extract frames from the data URL with timeout
                        const video = document.createElement('video');
                        video.src = mediaData;

                        const frameExtractionPromise = new Promise((resolve) => {
                            video.addEventListener('loadedmetadata', async () => {
                                const duration = elemData.duration || Math.ceil(video.duration);
                                await extractVideoFrames(video, duration, newElement);
                                resolve(true);
                            });
                        });

                        const timeoutPromise = new Promise((resolve) => {
                            setTimeout(() => {
                                console.warn(`[DESERIALIZE VIDEO ISSUE #3] Old format timeout for ${newElement.dataset.elementId}`);
                                resolve(false);
                            }, 15000);
                        });

                        await Promise.race([frameExtractionPromise, timeoutPromise]);
                    }
                } else {
                    console.warn('[DESERIALIZE VIDEO] No valid media data in JSON');
                    newElement.dataset.mediaMissing = 'true';
                }

                newElement.dataset.shouldLoop = elemData.shouldLoop || false;
                newElement.dataset.videoStartTime = elemData.videoStartTime || 0;
                newElement.dataset.elementName = 'VIDEO';
            } else if (elemData.type === 'image') {
                const mediaData = elemData.mediaUrl || elemData.mediaReference;

                if (mediaData && typeof mediaData === 'object' && mediaData.storage === 'indexeddb') {
                    // IndexedDB reference - look up the file
                    console.log(`Image: Looking up IndexedDB key ${mediaData.key}`);
                    const mediaFile = await getMediaFile(mediaData.key);

                    if (mediaFile) {
                        // Found in IndexedDB - restore image
                        newElement.dataset.imageData = mediaFile.dataURL;
                        newElement.dataset.imageFile = mediaFile.filename;
                        newElement.dataset.mediaKey = mediaData.key;
                        console.log(`Image restored from IndexedDB: ${mediaFile.filename}`);
                    } else {
                        // Not found in IndexedDB - mark as missing
                        console.warn(`Image not found in IndexedDB: ${mediaData.key}`);
                        newElement.dataset.imageFile = mediaData.filename;
                        newElement.dataset.mediaMissing = 'true';
                        newElement.dataset.mediaKey = mediaData.key;
                    }
                } else if (typeof mediaData === 'string') {
                    // Old format: direct data URL
                    newElement.dataset.imageData = mediaData;
                    console.log('Image element: restored from old format (data URL)');
                } else {
                    console.warn('Image element loaded from JSON without valid media data');
                    newElement.dataset.mediaMissing = 'true';
                }

                newElement.dataset.elementName = 'IMAGE';
            } else if (elemData.type === 'pool') {
                // Handle both new poolReference format and old poolData format
                const poolRef = elemData.poolReference || elemData.poolData;
                const poolName = elemData.poolName || (poolRef ? poolRef.poolName || poolRef.name : null);
                const poolType = elemData.poolType || (poolRef ? poolRef.poolType || poolRef.type : 'video');

                console.log(`[DESERIALIZE POOL] Processing pool element: name=${poolName}, type=${poolType}`);

                if (poolRef && typeof poolRef === 'object') {
                    if (poolRef.storage === 'indexeddb' && poolRef.poolId) {
                        // New format: IndexedDB reference - look up by ID
                        console.log(`[DESERIALIZE POOL] Looking up pool in IndexedDB: ID=${poolRef.poolId}, type=${poolType}`);
                        
                        try {
                            const pool = await getPoolById(poolRef.poolId, poolType);
                            
                            if (pool) {
                                // Found in IndexedDB - restore full pool
                                console.log(`[DESERIALIZE POOL] ✓ Pool restored from IndexedDB: ${pool.name} (ID: ${pool.id})`);
                                newElement.dataset.poolData = JSON.stringify(pool);
                                newElement.dataset.poolName = pool.name;
                                newElement.dataset.poolType = pool.type;
                                newElement.dataset.elementName = pool.name;
                                
                                // Also add to in-memory array if not already there
                                const pools = poolType === 'video' ? videoPools : imagePools;
                                if (!pools.find(p => p.id === pool.id)) {
                                    pools.push(pool);
                                    console.log(`[DESERIALIZE POOL] Added pool to in-memory ${poolType}Pools array`);
                                }
                            } else {
                                // Not found in IndexedDB - mark as missing
                                console.warn(`[DESERIALIZE POOL] Pool not found in IndexedDB: ID=${poolRef.poolId}`);
                                newElement.dataset.poolName = poolName;
                                newElement.dataset.poolType = poolType;
                                newElement.dataset.mediaMissing = 'true';
                                newElement.dataset.elementName = `${poolName} (missing)`;
                            }
                        } catch (err) {
                            console.error(`[DESERIALIZE POOL ERROR] Failed to lookup pool: ID=${poolRef.poolId}:`, err);
                            newElement.dataset.poolName = poolName;
                            newElement.dataset.poolType = poolType;
                            newElement.dataset.mediaMissing = 'true';
                            newElement.dataset.errorMessage = err.message;
                            newElement.dataset.elementName = `${poolName} (error)`;
                        }
                    } else if (poolRef.files) {
                        // Old format: Full pool data embedded
                        console.log(`[DESERIALIZE POOL] Using embedded pool data: ${poolName}`);
                        newElement.dataset.poolData = JSON.stringify(poolRef);
                        newElement.dataset.poolName = poolName;
                        newElement.dataset.poolType = poolType;
                        newElement.dataset.elementName = poolName;
                    } else {
                        // Invalid format
                        console.warn(`[DESERIALIZE POOL] Invalid pool data format`);
                        newElement.dataset.poolName = poolName;
                        newElement.dataset.poolType = poolType;
                        newElement.dataset.mediaMissing = 'true';
                        newElement.dataset.elementName = `${poolName} (missing)`;
                    }
                }
            } else if (elemData.type === 'ai-video') {
                if (elemData.aiVideoConfig) {
                    newElement.dataset.aiVideoConfig = JSON.stringify(elemData.aiVideoConfig);
                }
                // Handle split video fields
                if (elemData.videoSource) {
                    newElement.dataset.videoSource = elemData.videoSource;
                }
                if (elemData.videoTrim) {
                    newElement.dataset.videoTrim = JSON.stringify(elemData.videoTrim);
                }
                newElement.dataset.elementName = 'AI VIDEO';
            } else if (elemData.type === 'ai-image') {
                if (elemData.aiImageConfig) {
                    newElement.dataset.aiImageConfig = JSON.stringify(elemData.aiImageConfig);
                }
                newElement.dataset.elementName = 'AI IMAGE';
            }

            // Insert before the "Add Element" button (always get fresh reference)
            // The "Add Element" button is the last timeline-element without finalized="true"
            const addElementBtn = Array.from(elementsRow.querySelectorAll('.timeline-element')).find(el => !el.dataset.finalized || el.dataset.finalized === 'false');
            if (addElementBtn) {
                elementsRow.insertBefore(newElement, addElementBtn);
            } else {
                // Fallback: insert at end if no add button found
                elementsRow.appendChild(newElement);
            }

            // Use the existing finalizeElement function to create proper visuals and setup handlers
            console.log(`[DESERIALIZE] Calling finalizeElement for ${newElement.dataset.elementId}, type=${elemData.type}`);
            console.log(`[DESERIALIZE] Pre-finalize state: type=${newElement.dataset.type}, finalized=${newElement.dataset.finalized}`);

            try {
                finalizeElement(newElement, elemData.type, newElement.dataset.elementId);
                console.log(`[DESERIALIZE] ✓ finalizeElement completed for ${newElement.dataset.elementId}`);
                console.log(`[DESERIALIZE] Post-finalize state: type=${newElement.dataset.type}, finalized=${newElement.dataset.finalized}`);
            } catch (error) {
                console.error(`[DESERIALIZE ERROR] finalizeElement failed for ${newElement.dataset.elementId}:`, error);
                console.error(`[DESERIALIZE ERROR] Error stack:`, error.stack);
                
                // RECOVERY: Ensure element is marked as finalized even if finalizeElement failed
                // This prevents element from being silently dropped from subsequent exports
                if (newElement.dataset.finalized !== 'true') {
                    console.log(`[DESERIALIZE RECOVERY] Manually marking element ${newElement.dataset.elementId} as finalized`);
                    newElement.dataset.finalized = 'true';
                    
                    // Add minimal visual indicator
                    const contentDiv = newElement.querySelector('.element-content');
                    if (contentDiv && !contentDiv.innerHTML) {
                        contentDiv.innerHTML = `
                            <div class="element-preview" style="background: #ff3b30;">
                                <div class="element-type-badge">${elemData.type.toUpperCase()} (ERROR)</div>
                                <div class="duration-indicator">${elemData.duration}s</div>
                            </div>
                        `;
                    }
                }
                
                // Don't re-throw - allow other elements to continue loading
                console.log(`[DESERIALIZE RECOVERY] Element ${newElement.dataset.elementId} recovered, continuing with next element`);
            }
        }

        /**
         * Create an edit element from JSON data
         */
        async function createEditFromJSON(editData) {
            const editTrack = document.getElementById('editTrack');
            const lastEdit = editTrack.querySelector('.edit-element:last-child');

            // Create new edit element
            const newEdit = document.createElement('div');
            newEdit.className = 'edit-element';
            newEdit.dataset.editId = editData.id;
            newEdit.dataset.duration = editData.duration;
            newEdit.dataset.overlayUrl = editData.overlayUrl;

            // Calculate pixel position from start time
            const leftPosition = editData.startTime * PIXEL_PER_SECOND;
            newEdit.style.left = `${leftPosition}px`;

            // Set width based on duration
            const width = editData.duration * PIXEL_PER_SECOND;
            newEdit.style.width = `${width}px`;

            // Create initial content structure
            const content = document.createElement('div');
            content.className = 'edit-content';
            newEdit.appendChild(content);

            // Add resize handle
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            newEdit.appendChild(resizeHandle);

            // Insert before last edit
            editTrack.insertBefore(newEdit, lastEdit);

            // Use finalizeEditElement to create proper visual content
            finalizeEditElement(newEdit);

            // Setup resize handlers
            setupEditResizeHandlers(newEdit);
        }

        // ===== JSON MODAL HANDLERS =====

        const seeJsonButton = document.getElementById('seeJsonButton');
        const seeJsonButtonInline = document.getElementById('seeJsonButtonInline');
        const jsonModal = document.getElementById('jsonModal');
        const jsonTextarea = document.getElementById('jsonTextarea');
        const jsonModalCopy = document.getElementById('jsonModalCopy');
        const jsonModalCancel = document.getElementById('jsonModalCancel');
        const jsonModalApply = document.getElementById('jsonModalApply');

        // Open JSON modal function
        async function openJsonModal() {
            const projectJSON = await serializeProjectToJSON();
            jsonTextarea.value = JSON.stringify(projectJSON, null, 2);
            jsonModal.classList.add('open');
        }

        // Open JSON modal - original button
        if (seeJsonButton) {
            seeJsonButton.addEventListener('click', openJsonModal);
        }

        // Open JSON modal - inline button
        if (seeJsonButtonInline) {
            seeJsonButtonInline.addEventListener('click', openJsonModal);
        }

        // Close JSON modal
        if (jsonModalCancel) {
            jsonModalCancel.addEventListener('click', () => {
                jsonModal.classList.remove('open');
            });
        }

        // Copy to clipboard
        if (jsonModalCopy) {
            jsonModalCopy.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(jsonTextarea.value);
                    jsonModalCopy.textContent = 'Copied!';
                    setTimeout(() => {
                        jsonModalCopy.textContent = 'Copy to Clipboard';
                    }, 2000);
                } catch (err) {
                    alert('Failed to copy to clipboard');
                }
            });
        }

        // Apply JSON
        if (jsonModalApply) {
            jsonModalApply.addEventListener('click', async () => {
                const jsonText = jsonTextarea.value;

                if (!jsonText.trim()) {
                    alert('Please paste a valid JSON configuration');
                    return;
                }

                const success = await deserializeJSONToProject(jsonText);

                if (success) {
                    jsonModal.classList.remove('open');
                    alert('Project loaded successfully!');
                }
            });
        }

        console.log('Project JSON system initialized');

        // ===== IMPORT VIDEO HANDLERS =====

        const importVideoButtonInline = document.getElementById('importVideoButtonInline');
        const importVideoModal = document.getElementById('importVideoModal');
        const importVideoFile = document.getElementById('importVideoFile');
        const importVideoCancel = document.getElementById('importVideoCancel');
        const importVideoGenerate = document.getElementById('importVideoGenerate');
        const importVideoStatus = document.getElementById('importVideoStatus');
        const importVideoStatusText = document.getElementById('importVideoStatusText');
        const importVideoProgressBar = document.getElementById('importVideoProgressBar');

        // Open import video modal
        if (importVideoButtonInline) {
            importVideoButtonInline.addEventListener('click', () => {
                importVideoModal.classList.add('open');
                importVideoFile.value = '';
                importVideoStatus.style.display = 'none';
                importVideoProgressBar.style.width = '0%';
            });
        }

        // Close import video modal
        if (importVideoCancel) {
            importVideoCancel.addEventListener('click', () => {
                importVideoModal.classList.remove('open');
            });
        }

        // Handle video import and generation
        if (importVideoGenerate) {
            importVideoGenerate.addEventListener('click', async () => {
                const file = importVideoFile.files[0];

                if (!file) {
                    alert('Please select a video file');
                    return;
                }

                // Validate file type
                const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/mpeg', 'video/webm'];
                if (!allowedTypes.includes(file.type)) {
                    alert('Invalid file type. Please select MP4, MOV, AVI, MPEG, or WebM');
                    return;
                }

                // Validate file size (max 100MB)
                const maxSize = 100 * 1024 * 1024; // 100MB
                if (file.size > maxSize) {
                    alert(`File too large (${(file.size / (1024*1024)).toFixed(1)}MB). Maximum allowed: 100MB`);
                    return;
                }

                // Show status
                importVideoStatus.style.display = 'block';
                importVideoStatusText.textContent = 'Uploading video...';
                importVideoProgressBar.style.width = '30%';
                importVideoGenerate.disabled = true;
                importVideoCancel.disabled = true;

                try {
                    // Create FormData
                    const formData = new FormData();
                    formData.append('video', file);

                    // Update status
                    importVideoStatusText.textContent = 'Analyzing video with Gemini AI...';
                    importVideoProgressBar.style.width = '60%';

                    // Call API
                    const response = await fetch((window.API_BASE_URL || '') + '/api/creator/import-video/', {
                        method: 'POST',
                        body: formData
                    });

                    const data = await response.json();

                    if (!response.ok) {
                        throw new Error(data.error || 'Failed to import video');
                    }

                    // Update status
                    importVideoStatusText.textContent = 'Loading timeline...';
                    importVideoProgressBar.style.width = '90%';

                    // Log the multi-stage analysis outputs
                    if (data.timeline.metadata && data.timeline.metadata.multiStageAnalysis) {
                        const stages = data.timeline.metadata.multiStageAnalysis;

                        console.log('='.repeat(80));
                        console.log('MULTI-STAGE VIDEO ANALYSIS RESULTS');
                        console.log('='.repeat(80));

                        if (stages.foundation) {
                            console.log('\n' + '='.repeat(80));
                            console.log('STAGE 1: FOUNDATION ANALYSIS (Transcript + Context)');
                            console.log('='.repeat(80));
                            console.log(JSON.stringify(stages.foundation, null, 2));
                        }

                        if (stages.segmentation) {
                            console.log('\n' + '='.repeat(80));
                            console.log('STAGE 2: SCENE SEGMENTATION (Visual + Overlays)');
                            console.log('='.repeat(80));
                            console.log(JSON.stringify(stages.segmentation, null, 2));
                        }

                        if (stages.consolidation) {
                            console.log('\n' + '='.repeat(80));
                            console.log('STAGE 3: CONSOLIDATION ANALYSIS (Pattern Detection)');
                            console.log('='.repeat(80));
                            console.log(JSON.stringify(stages.consolidation, null, 2));
                        }

                        if (stages.strategy) {
                            console.log('\n' + '='.repeat(80));
                            console.log('STAGE 4: ELEMENT STRATEGY (Type Decisions + Notes)');
                            console.log('='.repeat(80));
                            console.log(JSON.stringify(stages.strategy, null, 2));
                        }

                        if (stages.summary) {
                            console.log('\n' + '='.repeat(80));
                            console.log('ANALYSIS SUMMARY');
                            console.log('='.repeat(80));
                            console.log(JSON.stringify(stages.summary, null, 2));
                        }

                        console.log('\n' + '='.repeat(80));
                    }

                    // Log the video description from Gemini's initial analysis (legacy support)
                    if (data.timeline.metadata && data.timeline.metadata.videoDescription) {
                        console.log('=== GEMINI VIDEO ANALYSIS (Step 1) ===');
                        console.log(data.timeline.metadata.videoDescription);
                        console.log('======================================');
                    }

                    // Log notes for each element
                    if (data.timeline.timeline && data.timeline.timeline.elements) {
                        console.log('=== ELEMENT NOTES ===');
                        data.timeline.timeline.elements.forEach((element, index) => {
                            if (element.notes) {
                                console.log(`Element ${index + 1} (${element.type}): ${element.notes}`);
                            }
                        });
                        console.log('====================');
                    }

                    // Load the generated JSON into the timeline
                    const jsonText = JSON.stringify(data.timeline);
                    const success = await deserializeJSONToProject(jsonText);

                    if (success) {
                        importVideoProgressBar.style.width = '100%';
                        importVideoStatusText.textContent = 'Success!';

                        // Close modal after brief delay
                        setTimeout(() => {
                            importVideoModal.classList.remove('open');
                            alert(`Video imported successfully!\n${data.message}\n\nCheck browser console for detailed analysis.`);
                        }, 500);
                    } else {
                        throw new Error('Failed to load timeline from generated JSON');
                    }

                } catch (error) {
                    console.error('Import video error:', error);
                    importVideoStatusText.textContent = 'Error: ' + error.message;
                    importVideoProgressBar.style.width = '0%';
                    importVideoStatus.style.background = '#ffebee';
                    alert('Failed to import video: ' + error.message);
                } finally {
                    importVideoGenerate.disabled = false;
                    importVideoCancel.disabled = false;
                }
            });
        }

        console.log('Import video system initialized');
