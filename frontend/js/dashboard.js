(function() {
    const DB_NAME = 'BeamreelsDB';
    const DB_VERSION = 1;
    const TEMPLATES_STORE = 'templates';

    let db = null;
    let templates = [];
    let currentView = 'grid';
    let selectedTemplateId = null;

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);

            request.onsuccess = () => {
                db = request.result;
                resolve(db);
            };

            request.onupgradeneeded = (event) => {
                const database = event.target.result;

                if (!database.objectStoreNames.contains(TEMPLATES_STORE)) {
                    const store = database.createObjectStore(TEMPLATES_STORE, { keyPath: 'id' });
                    store.createIndex('name', 'name', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                    store.createIndex('updatedAt', 'updatedAt', { unique: false });
                }
            };
        });
    }

    function getAllTemplates() {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([TEMPLATES_STORE], 'readonly');
            const store = transaction.objectStore(TEMPLATES_STORE);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    function saveTemplate(template) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([TEMPLATES_STORE], 'readwrite');
            const store = transaction.objectStore(TEMPLATES_STORE);
            const request = store.put(template);

            request.onsuccess = () => resolve(template);
            request.onerror = () => reject(request.error);
        });
    }

    function deleteTemplate(id) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([TEMPLATES_STORE], 'readwrite');
            const store = transaction.objectStore(TEMPLATES_STORE);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    function generateId() {
        return 'tpl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    function formatDate(date) {
        const d = new Date(date);
        const now = new Date();
        const diff = now - d;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) return 'Today';
        if (days === 1) return 'Yesterday';
        if (days < 7) return `${days} days ago`;

        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function createTemplateCard(template) {
        const card = document.createElement('div');
        card.className = 'template-card';
        card.dataset.id = template.id;

        const thumbnail = template.thumbnail || null;
        const thumbnailContent = thumbnail
            ? `<img src="${thumbnail}" alt="${template.name}">`
            : `<div class="template-card-thumbnail-placeholder">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="2" y="2" width="20" height="20" rx="2"/>
                    <path d="M10 9l5 3-5 3V9z"/>
                </svg>
               </div>`;

        card.innerHTML = `
            <div class="template-card-thumbnail">
                ${thumbnailContent}
                ${template.elements ? `<span class="template-card-badge">${template.elements.length} clips</span>` : ''}
                <button class="template-card-menu" data-action="menu">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="6" r="1.5"/>
                        <circle cx="12" cy="12" r="1.5"/>
                        <circle cx="12" cy="18" r="1.5"/>
                    </svg>
                </button>
            </div>
            <div class="template-card-info">
                <h3 class="template-card-name">${template.name}</h3>
                <div class="template-card-meta">
                    <span>${formatDate(template.updatedAt || template.createdAt)}</span>
                    ${template.exports ? `<span>${template.exports} exports</span>` : ''}
                </div>
            </div>
        `;

        card.addEventListener('click', (e) => {
            if (e.target.closest('[data-action="menu"]')) {
                e.stopPropagation();
                openTemplateActions(template.id, template.name);
                return;
            }
            openTemplate(template.id);
        });

        return card;
    }

    function renderTemplates(filterText = '') {
        const grid = document.getElementById('templatesGrid');
        const emptyState = document.getElementById('emptyState');
        const createCard = document.getElementById('createNewCard');

        grid.innerHTML = '';
        grid.appendChild(createCard);

        let filteredTemplates = templates;

        if (filterText) {
            const searchLower = filterText.toLowerCase();
            filteredTemplates = templates.filter(t =>
                t.name.toLowerCase().includes(searchLower)
            );
        }

        const sortValue = document.getElementById('sortSelect').value;
        filteredTemplates.sort((a, b) => {
            switch (sortValue) {
                case 'name':
                    return a.name.localeCompare(b.name);
                case 'exports':
                    return (b.exports || 0) - (a.exports || 0);
                case 'recent':
                default:
                    return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
            }
        });

        filteredTemplates.forEach(template => {
            grid.appendChild(createTemplateCard(template));
        });

        if (templates.length === 0) {
            emptyState.style.display = 'flex';
            createCard.style.display = 'none';
        } else {
            emptyState.style.display = 'none';
            createCard.style.display = 'flex';
        }
    }

    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('open');
        }
    }

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('open');
        }
    }

    function closeAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.classList.remove('open');
        });
    }

    function openTemplate(id) {
        const template = templates.find(t => t.id === id);
        if (template) {
            localStorage.setItem('currentTemplateId', id);
            localStorage.setItem('currentTemplateData', JSON.stringify(template));
            window.location.href = 'creator.html';
        }
    }

    function openTemplateActions(id, name) {
        selectedTemplateId = id;
        document.getElementById('templateActionsTitle').textContent = name;
        openModal('templateActionsModal');
    }

    async function duplicateTemplate(id) {
        const original = templates.find(t => t.id === id);
        if (!original) return;

        const duplicate = {
            ...original,
            id: generateId(),
            name: `${original.name} (Copy)`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            exports: 0
        };

        await saveTemplate(duplicate);
        templates.push(duplicate);
        renderTemplates();
        closeAllModals();
        showToast('Template duplicated');
    }

    async function renameTemplate(id) {
        const template = templates.find(t => t.id === id);
        if (!template) return;

        const newName = prompt('Enter new name:', template.name);
        if (newName && newName.trim()) {
            template.name = newName.trim();
            template.updatedAt = new Date().toISOString();
            await saveTemplate(template);
            renderTemplates();
            closeAllModals();
            showToast('Template renamed');
        }
    }

    async function removeTemplate(id) {
        if (!confirm('Are you sure you want to delete this template?')) return;

        await deleteTemplate(id);
        templates = templates.filter(t => t.id !== id);
        renderTemplates();
        closeAllModals();
        showToast('Template deleted');
    }

    function showToast(message) {
        const toast = document.getElementById('toast');
        const toastMessage = document.getElementById('toastMessage');
        toastMessage.textContent = message;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    function handleVideoUpload(file) {
        if (!file || !file.type.startsWith('video/')) {
            showToast('Please select a valid video file');
            return;
        }

        const maxSize = 100 * 1024 * 1024;
        if (file.size > maxSize) {
            showToast('Video file is too large. Max size is 100MB');
            return;
        }

        const uploadZone = document.getElementById('uploadZone');
        const uploadProgress = document.getElementById('uploadProgress');
        const uploadFilename = document.getElementById('uploadFilename');
        const uploadPercentage = document.getElementById('uploadPercentage');
        const uploadProgressFill = document.getElementById('uploadProgressFill');
        const uploadStatus = document.getElementById('uploadStatus');
        const analyzeBtn = document.getElementById('analyzeVideoBtn');

        uploadZone.style.display = 'none';
        uploadProgress.style.display = 'block';
        uploadFilename.textContent = file.name;

        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
                uploadStatus.textContent = 'Ready to analyze';
                analyzeBtn.disabled = false;
                analyzeBtn.dataset.file = file.name;
            }
            uploadPercentage.textContent = Math.round(progress) + '%';
            uploadProgressFill.style.width = progress + '%';
        }, 200);

        const reader = new FileReader();
        reader.onload = () => {
            analyzeBtn.dataset.videoData = reader.result;
        };
        reader.readAsDataURL(file);
    }

    async function createTemplateFromVideo() {
        const analyzeBtn = document.getElementById('analyzeVideoBtn');
        const videoData = analyzeBtn.dataset.videoData;
        const fileName = analyzeBtn.dataset.file || 'Imported Video';

        const uploadStatus = document.getElementById('uploadStatus');
        uploadStatus.textContent = 'Creating template...';
        analyzeBtn.disabled = true;

        const template = {
            id: generateId(),
            name: fileName.replace(/\.[^/.]+$/, ''),
            thumbnail: videoData ? await generateVideoThumbnail(videoData) : null,
            elements: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            exports: 0,
            sourceVideo: videoData
        };

        await saveTemplate(template);
        templates.push(template);

        closeAllModals();
        renderTemplates();
        showToast('Template created');

        setTimeout(() => {
            openTemplate(template.id);
        }, 500);
    }

    function generateVideoThumbnail(videoData) {
        return new Promise((resolve) => {
            const video = document.createElement('video');
            video.src = videoData;
            video.crossOrigin = 'anonymous';
            video.muted = true;

            video.onloadeddata = () => {
                video.currentTime = 0.5;
            };

            video.onseeked = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 180;
                canvas.height = 320;
                const ctx = canvas.getContext('2d');

                const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
                const x = (canvas.width - video.videoWidth * scale) / 2;
                const y = (canvas.height - video.videoHeight * scale) / 2;

                ctx.drawImage(video, x, y, video.videoWidth * scale, video.videoHeight * scale);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };

            video.onerror = () => resolve(null);

            setTimeout(() => resolve(null), 5000);
        });
    }

    async function createBlankTemplate() {
        const template = {
            id: generateId(),
            name: 'Untitled Template',
            thumbnail: null,
            elements: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            exports: 0
        };

        await saveTemplate(template);
        templates.push(template);

        closeAllModals();
        renderTemplates();

        openTemplate(template.id);
    }

    function setupEventListeners() {
        document.getElementById('newTemplateBtn').addEventListener('click', () => {
            openModal('newTemplateModal');
        });

        document.getElementById('createNewCard').addEventListener('click', () => {
            openModal('newTemplateModal');
        });

        document.getElementById('emptyStateCreateBtn')?.addEventListener('click', () => {
            openModal('newTemplateModal');
        });

        document.getElementById('importTemplateBtn').addEventListener('click', () => {
            openModal('importVideoModal');
        });

        document.getElementById('closeNewTemplateModal').addEventListener('click', () => {
            closeModal('newTemplateModal');
        });

        document.getElementById('closeImportVideoModal').addEventListener('click', () => {
            closeModal('importVideoModal');
            resetUploadState();
        });

        document.getElementById('closeUrlImportModal').addEventListener('click', () => {
            closeModal('urlImportModal');
        });

        document.getElementById('closeTemplateActionsModal').addEventListener('click', () => {
            closeModal('templateActionsModal');
        });

        document.getElementById('createFromScratch').addEventListener('click', () => {
            closeModal('newTemplateModal');
            createBlankTemplate();
        });

        document.getElementById('createFromVideo').addEventListener('click', () => {
            closeModal('newTemplateModal');
            openModal('importVideoModal');
        });

        document.getElementById('createFromUrl').addEventListener('click', () => {
            closeModal('newTemplateModal');
            openModal('urlImportModal');
        });

        const uploadZone = document.getElementById('uploadZone');
        const videoFileInput = document.getElementById('videoFileInput');

        uploadZone.addEventListener('click', () => {
            videoFileInput.click();
        });

        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragging');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragging');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragging');
            const file = e.dataTransfer.files[0];
            handleVideoUpload(file);
        });

        videoFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            handleVideoUpload(file);
        });

        document.getElementById('cancelImportBtn').addEventListener('click', () => {
            closeModal('importVideoModal');
            resetUploadState();
        });

        document.getElementById('analyzeVideoBtn').addEventListener('click', createTemplateFromVideo);

        const videoUrlInput = document.getElementById('videoUrlInput');
        const fetchVideoBtn = document.getElementById('fetchVideoBtn');

        videoUrlInput.addEventListener('input', () => {
            const url = videoUrlInput.value.trim();
            const isValidUrl = url.includes('tiktok.com') ||
                              url.includes('instagram.com') ||
                              url.includes('youtube.com') ||
                              url.includes('youtu.be');
            fetchVideoBtn.disabled = !isValidUrl;
        });

        document.getElementById('cancelUrlImportBtn').addEventListener('click', () => {
            closeModal('urlImportModal');
            videoUrlInput.value = '';
            fetchVideoBtn.disabled = true;
        });

        fetchVideoBtn.addEventListener('click', () => {
            showToast('URL import coming soon');
            closeModal('urlImportModal');
        });

        document.getElementById('editTemplateAction').addEventListener('click', () => {
            if (selectedTemplateId) {
                openTemplate(selectedTemplateId);
            }
        });

        document.getElementById('duplicateTemplateAction').addEventListener('click', () => {
            if (selectedTemplateId) {
                duplicateTemplate(selectedTemplateId);
            }
        });

        document.getElementById('renameTemplateAction').addEventListener('click', () => {
            if (selectedTemplateId) {
                renameTemplate(selectedTemplateId);
            }
        });

        document.getElementById('deleteTemplateAction').addEventListener('click', () => {
            if (selectedTemplateId) {
                removeTemplate(selectedTemplateId);
            }
        });

        document.getElementById('searchInput').addEventListener('input', (e) => {
            renderTemplates(e.target.value);
        });

        document.getElementById('sortSelect').addEventListener('change', () => {
            renderTemplates(document.getElementById('searchInput').value);
        });

        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentView = btn.dataset.view;
            });
        });

        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeAllModals();
                    resetUploadState();
                }
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeAllModals();
                resetUploadState();
            }
        });
    }

    function resetUploadState() {
        const uploadZone = document.getElementById('uploadZone');
        const uploadProgress = document.getElementById('uploadProgress');
        const videoFileInput = document.getElementById('videoFileInput');
        const analyzeBtn = document.getElementById('analyzeVideoBtn');
        const uploadProgressFill = document.getElementById('uploadProgressFill');

        uploadZone.style.display = 'block';
        uploadProgress.style.display = 'none';
        videoFileInput.value = '';
        analyzeBtn.disabled = true;
        analyzeBtn.dataset.file = '';
        analyzeBtn.dataset.videoData = '';
        uploadProgressFill.style.width = '0%';
    }

    async function init() {
        try {
            await initDB();
            templates = await getAllTemplates();
            renderTemplates();
            setupEventListeners();
        } catch (error) {
            console.error('Failed to initialize dashboard:', error);
            showToast('Failed to load templates');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
