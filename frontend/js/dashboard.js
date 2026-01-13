(function() {
    let supabase = null;
    let templates = [];
    let currentView = 'grid';
    let selectedTemplateId = null;
    let deviceId = null;

    function getDeviceId() {
        let id = localStorage.getItem('beamreels_device_id');
        if (!id) {
            id = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('beamreels_device_id', id);
        }
        return id;
    }

    function initSupabase() {
        if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
            console.error('Supabase configuration missing');
            return false;
        }
        supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
        deviceId = getDeviceId();
        return true;
    }

    async function getAllTemplates() {
        const { data, error } = await supabase
            .from('templates')
            .select('*')
            .eq('device_id', deviceId)
            .order('updated_at', { ascending: false });

        if (error) {
            console.error('Error fetching templates:', error);
            return [];
        }
        return data || [];
    }

    async function saveTemplate(template) {
        const { data, error } = await supabase
            .from('templates')
            .upsert({
                id: template.id,
                device_id: deviceId,
                name: template.name,
                thumbnail: template.thumbnail,
                timeline_data: template.timeline_data || { elements: [], overlays: [], variablePools: {} },
                exports_count: template.exports_count || 0,
                updated_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) {
            console.error('Error saving template:', error);
            throw error;
        }
        return data;
    }

    async function deleteTemplateFromDB(id) {
        const { error } = await supabase
            .from('templates')
            .delete()
            .eq('id', id)
            .eq('device_id', deviceId);

        if (error) {
            console.error('Error deleting template:', error);
            throw error;
        }
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

    function getElementCount(template) {
        if (template.timeline_data && template.timeline_data.elements) {
            return template.timeline_data.elements.length;
        }
        return 0;
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

        const elementCount = getElementCount(template);

        card.innerHTML = `
            <div class="template-card-thumbnail">
                ${thumbnailContent}
                ${elementCount > 0 ? `<span class="template-card-badge">${elementCount} clips</span>` : ''}
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
                    <span>${formatDate(template.updated_at || template.created_at)}</span>
                    ${template.exports_count ? `<span>${template.exports_count} exports</span>` : ''}
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
                    return (b.exports_count || 0) - (a.exports_count || 0);
                case 'recent':
                default:
                    return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
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
        localStorage.setItem('currentTemplateId', id);
        window.location.href = 'creator.html';
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
            id: crypto.randomUUID(),
            device_id: deviceId,
            name: `${original.name} (Copy)`,
            thumbnail: original.thumbnail,
            timeline_data: JSON.parse(JSON.stringify(original.timeline_data || {})),
            exports_count: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        try {
            const saved = await saveTemplate(duplicate);
            templates.unshift(saved);
            renderTemplates();
            closeAllModals();
            showToast('Template duplicated');
        } catch (err) {
            showToast('Failed to duplicate template');
        }
    }

    async function renameTemplate(id) {
        const template = templates.find(t => t.id === id);
        if (!template) return;

        const newName = prompt('Enter new name:', template.name);
        if (newName && newName.trim()) {
            template.name = newName.trim();
            template.updated_at = new Date().toISOString();
            try {
                await saveTemplate(template);
                renderTemplates();
                closeAllModals();
                showToast('Template renamed');
            } catch (err) {
                showToast('Failed to rename template');
            }
        }
    }

    async function removeTemplate(id) {
        if (!confirm('Are you sure you want to delete this template?')) return;

        try {
            await deleteTemplateFromDB(id);
            templates = templates.filter(t => t.id !== id);
            renderTemplates();
            closeAllModals();
            showToast('Template deleted');
        } catch (err) {
            showToast('Failed to delete template');
        }
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

        const thumbnail = videoData ? await generateVideoThumbnail(videoData) : null;

        const template = {
            id: crypto.randomUUID(),
            device_id: deviceId,
            name: fileName.replace(/\.[^/.]+$/, ''),
            thumbnail: thumbnail,
            timeline_data: { elements: [], overlays: [], variablePools: {} },
            exports_count: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        try {
            const saved = await saveTemplate(template);
            templates.unshift(saved);
            closeAllModals();
            renderTemplates();
            showToast('Template created');

            setTimeout(() => {
                openTemplate(saved.id);
            }, 500);
        } catch (err) {
            showToast('Failed to create template');
        }
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
            id: crypto.randomUUID(),
            device_id: deviceId,
            name: 'Untitled Template',
            thumbnail: null,
            timeline_data: { elements: [], overlays: [], variablePools: {} },
            exports_count: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        try {
            const saved = await saveTemplate(template);
            templates.unshift(saved);
            closeAllModals();
            renderTemplates();
            openTemplate(saved.id);
        } catch (err) {
            showToast('Failed to create template');
        }
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
            if (!initSupabase()) {
                showToast('Failed to connect to database');
                return;
            }
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
