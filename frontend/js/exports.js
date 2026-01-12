(function() {
    const DB_NAME = 'BeamreelsDB';
    const DB_VERSION = 1;
    const EXPORTS_STORE = 'exports';

    let db = null;
    let exports = [];
    let currentFilter = 'all';
    let selectedExport = null;

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

                if (!database.objectStoreNames.contains(EXPORTS_STORE)) {
                    const store = database.createObjectStore(EXPORTS_STORE, { keyPath: 'id' });
                    store.createIndex('templateId', 'templateId', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                    store.createIndex('status', 'status', { unique: false });
                }
            };
        });
    }

    function getAllExports() {
        return new Promise((resolve, reject) => {
            if (!db.objectStoreNames.contains(EXPORTS_STORE)) {
                resolve([]);
                return;
            }

            const transaction = db.transaction([EXPORTS_STORE], 'readonly');
            const store = transaction.objectStore(EXPORTS_STORE);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    function deleteExport(id) {
        return new Promise((resolve, reject) => {
            if (!db.objectStoreNames.contains(EXPORTS_STORE)) {
                resolve();
                return;
            }

            const transaction = db.transaction([EXPORTS_STORE], 'readwrite');
            const store = transaction.objectStore(EXPORTS_STORE);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    function formatDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) {
            const hours = Math.floor(diff / (1000 * 60 * 60));
            if (hours === 0) {
                const minutes = Math.floor(diff / (1000 * 60));
                return minutes <= 1 ? 'Just now' : `${minutes} minutes ago`;
            }
            return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
        }
        if (days === 1) return 'Yesterday';
        if (days < 7) return `${days} days ago`;

        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function groupExportsByTemplate(exportsList) {
        const groups = {};

        exportsList.forEach(exp => {
            const templateName = exp.templateName || 'Unknown Template';
            if (!groups[templateName]) {
                groups[templateName] = {
                    templateName,
                    templateId: exp.templateId,
                    items: [],
                    latestDate: exp.createdAt
                };
            }
            groups[templateName].items.push(exp);
            if (new Date(exp.createdAt) > new Date(groups[templateName].latestDate)) {
                groups[templateName].latestDate = exp.createdAt;
            }
        });

        return Object.values(groups).sort((a, b) =>
            new Date(b.latestDate) - new Date(a.latestDate)
        );
    }

    function createExportItem(exp) {
        const item = document.createElement('div');
        item.className = `export-item ${exp.status || 'completed'}`;
        item.dataset.id = exp.id;

        const thumbnailContent = exp.thumbnail
            ? `<img class="export-item-thumbnail" src="${exp.thumbnail}" alt="${exp.name}">`
            : `<div class="export-item-placeholder">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="2" y="2" width="20" height="20" rx="2"/>
                    <path d="M10 9l5 3-5 3V9z"/>
                </svg>
               </div>`;

        const statusBadge = exp.status && exp.status !== 'completed'
            ? `<span class="export-item-status ${exp.status}">${exp.status}</span>`
            : '';

        item.innerHTML = `
            ${thumbnailContent}
            ${statusBadge}
            ${exp.duration ? `<span class="export-item-duration">${formatDuration(exp.duration)}</span>` : ''}
            <div class="export-item-overlay">
                <span class="export-item-name">${exp.name || 'Video'}</span>
            </div>
            <div class="export-item-play">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
            </div>
        `;

        item.addEventListener('click', () => openPreview(exp));

        return item;
    }

    function createExportGroup(group) {
        const groupEl = document.createElement('div');
        groupEl.className = 'export-group';

        const completedCount = group.items.filter(i => i.status === 'completed' || !i.status).length;
        const processingCount = group.items.filter(i => i.status === 'processing').length;

        let statusText = `${group.items.length} video${group.items.length !== 1 ? 's' : ''}`;
        if (processingCount > 0) {
            statusText += ` (${processingCount} processing)`;
        }

        groupEl.innerHTML = `
            <div class="export-group-header">
                <div class="export-group-info">
                    <h3 class="export-group-title">${group.templateName}</h3>
                    <span class="export-group-meta">${statusText} - ${formatDate(group.latestDate)}</span>
                </div>
                <div class="export-group-actions">
                    <button class="export-group-btn download-group-btn" data-template="${group.templateId}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Download All
                    </button>
                </div>
            </div>
            <div class="export-items"></div>
        `;

        const itemsContainer = groupEl.querySelector('.export-items');
        group.items
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .forEach(exp => {
                itemsContainer.appendChild(createExportItem(exp));
            });

        const downloadBtn = groupEl.querySelector('.download-group-btn');
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadGroupVideos(group.items);
        });

        return groupEl;
    }

    function renderExports() {
        const listEl = document.getElementById('exportsList');
        const emptyState = document.getElementById('emptyState');
        const downloadAllBtn = document.getElementById('downloadAllBtn');

        let filteredExports = exports;

        if (currentFilter === 'completed') {
            filteredExports = exports.filter(e => e.status === 'completed' || !e.status);
        } else if (currentFilter === 'processing') {
            filteredExports = exports.filter(e => e.status === 'processing');
        }

        listEl.innerHTML = '';

        if (filteredExports.length === 0) {
            emptyState.style.display = 'flex';
            listEl.style.display = 'none';
            downloadAllBtn.disabled = true;
            return;
        }

        emptyState.style.display = 'none';
        listEl.style.display = 'flex';
        downloadAllBtn.disabled = filteredExports.length === 0;

        const sortValue = document.getElementById('sortSelect').value;

        if (sortValue === 'template') {
            const groups = groupExportsByTemplate(filteredExports);
            groups.forEach(group => {
                listEl.appendChild(createExportGroup(group));
            });
        } else {
            const singleGroup = {
                templateName: 'All Videos',
                items: filteredExports.sort((a, b) =>
                    new Date(b.createdAt) - new Date(a.createdAt)
                ),
                latestDate: filteredExports[0]?.createdAt
            };
            listEl.appendChild(createExportGroup(singleGroup));
        }
    }

    function openPreview(exp) {
        selectedExport = exp;
        const modal = document.getElementById('videoPreviewModal');
        const player = document.getElementById('previewPlayer');
        const title = document.getElementById('previewTitle');
        const meta = document.getElementById('previewMeta');

        title.textContent = exp.name || 'Video';
        meta.textContent = `From ${exp.templateName || 'template'} - ${formatDate(exp.createdAt)}`;

        if (exp.videoUrl || exp.videoData) {
            player.src = exp.videoUrl || exp.videoData;
        } else {
            player.src = '';
        }

        modal.classList.add('open');
    }

    function closePreview() {
        const modal = document.getElementById('videoPreviewModal');
        const player = document.getElementById('previewPlayer');
        player.pause();
        player.src = '';
        modal.classList.remove('open');
        selectedExport = null;
    }

    function downloadVideo(exp) {
        if (exp.videoUrl || exp.videoData) {
            const link = document.createElement('a');
            link.href = exp.videoUrl || exp.videoData;
            link.download = `${exp.name || 'video'}.mp4`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast('Download started');
        } else {
            showToast('Video not available for download');
        }
    }

    function downloadGroupVideos(items) {
        const downloadable = items.filter(i => i.videoUrl || i.videoData);
        if (downloadable.length === 0) {
            showToast('No videos available for download');
            return;
        }

        downloadable.forEach((exp, index) => {
            setTimeout(() => downloadVideo(exp), index * 500);
        });

        showToast(`Downloading ${downloadable.length} video${downloadable.length !== 1 ? 's' : ''}`);
    }

    async function removeExport(id) {
        if (!confirm('Are you sure you want to delete this video?')) return;

        await deleteExport(id);
        exports = exports.filter(e => e.id !== id);
        closePreview();
        renderExports();
        showToast('Video deleted');
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

    function setupEventListeners() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentFilter = btn.dataset.filter;
                renderExports();
            });
        });

        document.getElementById('sortSelect').addEventListener('change', renderExports);

        document.getElementById('downloadAllBtn').addEventListener('click', () => {
            const downloadable = exports.filter(e =>
                (e.status === 'completed' || !e.status) && (e.videoUrl || e.videoData)
            );
            downloadGroupVideos(downloadable);
        });

        document.getElementById('closeVideoPreview').addEventListener('click', closePreview);

        document.getElementById('downloadPreviewBtn').addEventListener('click', () => {
            if (selectedExport) {
                downloadVideo(selectedExport);
            }
        });

        document.getElementById('deletePreviewBtn').addEventListener('click', () => {
            if (selectedExport) {
                removeExport(selectedExport.id);
            }
        });

        document.getElementById('videoPreviewModal').addEventListener('click', (e) => {
            if (e.target.id === 'videoPreviewModal') {
                closePreview();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closePreview();
            }
        });
    }

    async function init() {
        try {
            await initDB();
            exports = await getAllExports();
            renderExports();
            setupEventListeners();
        } catch (error) {
            console.error('Failed to initialize exports:', error);
            exports = [];
            renderExports();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
