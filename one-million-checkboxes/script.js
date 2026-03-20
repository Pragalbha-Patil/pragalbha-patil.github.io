// ============ CONFIGURATION ============
const CONFIG = {
    numCheckboxes: 1000000,
    batchSize: 1000,
    databaseId: '667d0f99001b691d76cc',
    collectionId: '667d0fa8000f64e4decc',
    usersCollectionId: '66830ef30011252083cb',
    maxPendingUpdates: 50,
    updateBatchDelay: 2000,
    requestTimeout: 10000,
    scrollBatchSize: 100,
};

// ============ UTILITY FUNCTIONS ============
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ============ STATE MANAGER ============
class StateManager {
    constructor() {
        this.data = {
            checkboxStates: {},
            checkedCount: 0,
            renderedCount: 0,
            lastId: 0,
            loadedStateRanges: [],
            pendingUpdates: new Map(),
            isLoading: false,
            isAutoScrolling: false,
            lastScrollY: 0,
            ticking: false,
            userId: localStorage.getItem('userId'),
        };
    }

    getState() {
        return this.data;
    }

    updateCheckboxState(id, checked) {
        this.data.checkboxStates[id] = checked;
        this.recalculateCount();
    }

    setCheckedCount(count) {
        this.data.checkedCount = count;
    }

    recalculateCount() {
        this.data.checkedCount = Object.values(this.data.checkboxStates).filter(Boolean).length;
    }

    addPendingUpdate(id, checked) {
        this.data.pendingUpdates.set(id, checked);
    }

    getPendingUpdates() {
        const updates = Array.from(this.data.pendingUpdates.entries());
        this.data.pendingUpdates.clear();
        return updates;
    }

    hasPendingUpdates() {
        return this.data.pendingUpdates.size > 0;
    }

    setPendingUpdatesSize(size) {
        return this.data.pendingUpdates.size;
    }

    markRangeLoaded(start, end) {
        this.data.loadedStateRanges.push({ start, end });
    }

    isRangeLoaded(start, end) {
        return this.data.loadedStateRanges.some(
            range => !(end < range.start || start > range.end)
        );
    }
}

// ============ NETWORK SERVICE ============
class NetworkService {
    constructor() {
        console.log('[NETWORK] Constructor - checking Appwrite...');
        console.log('[NETWORK] Appwrite available?', typeof Appwrite !== 'undefined');
        
        const { Client, Databases, Query } = Appwrite;
        console.log('[NETWORK] Appwrite destructured successfully');
        
        this.client = new Client();
        this.client
            .setEndpoint('https://fra.cloud.appwrite.io/v1')
            .setProject('667d0f2d001c4fce8b90');
        this.databases = new Databases(this.client);
        this.Query = Query;
        
        console.log('[NETWORK] Client initialized');
    }

    async fetchCheckboxStates(limit = 1000, offset = 0) {
        try {
            const response = await Promise.race([
                this.databases.listDocuments(
                    CONFIG.databaseId,
                    CONFIG.collectionId,
                    [this.Query.limit(limit), this.Query.offset(offset)]
                ),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout')), CONFIG.requestTimeout)
                ),
            ]);
            return response?.documents || [];
        } catch (error) {
            console.error('Fetch error:', error);
            return [];
        }
    }

    async flushUpdates(updates) {
        if (updates.length === 0) return;

        const toCreate = [];
        const toDelete = [];

        for (const [id, isChecked] of updates) {
            const documentId = `id-${id}`;
            if (isChecked) {
                toCreate.push({ documentId, id, state: true });
            } else {
                toDelete.push(documentId);
            }
        }

        try {
            await Promise.allSettled([
                ...toCreate.map(op =>
                    this.databases
                        .createDocument(CONFIG.databaseId, CONFIG.collectionId, op.documentId, {
                            id: op.id,
                            state: true,
                        })
                        .catch(() =>
                            this.databases.updateDocument(
                                CONFIG.databaseId,
                                CONFIG.collectionId,
                                op.documentId,
                                { id: op.id, state: true }
                            )
                        )
                ),
                ...toDelete.map(docId =>
                    this.databases.deleteDocument(CONFIG.databaseId, CONFIG.collectionId, docId)
                ),
            ]);
        } catch (error) {
            console.error('Flush error:', error);
        }
    }

    subscribeToUpdates(callback) {
        this.client.subscribe(
            [`databases.${CONFIG.databaseId}.collections.${CONFIG.collectionId}.documents`],
            response => {
                if (!response?.events?.[0] || !response.payload?.id) return;
                const actionPerformed = response.events[0].split('.').pop();
                const id = String(response.payload.id);
                const state = actionPerformed !== 'delete' ? response.payload.state : false;
                callback(id, state);
            }
        );
    }
}

// ============ RENDER ENGINE ============
class RenderEngine {
    constructor(containerSelector) {
        this.container = document.querySelector(containerSelector);
        console.log('[RENDER] Constructor - looking for:', containerSelector);
        console.log('[RENDER] Container found:', !!this.container);
        if (!this.container) throw new Error(`Container ${containerSelector} not found`);
    }

    createCheckboxElement(id, isChecked, onchange) {
        const div = document.createElement('div');
        div.className = 'checkbox-item';
        div.dataset.id = id;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'form-check-input';
        checkbox.id = `checkbox-${id}`;
        checkbox.checked = isChecked;
        checkbox.addEventListener('change', () => onchange(id, checkbox.checked));

        div.appendChild(checkbox);
        return div;
    }

    renderBatch(startId, endId, checkboxStates, onchange) {
        const fragment = document.createDocumentFragment();
        for (let i = startId; i <= endId && i <= CONFIG.numCheckboxes; i++) {
            fragment.appendChild(
                this.createCheckboxElement(i, checkboxStates[i] || false, onchange)
            );
        }
        this.container.appendChild(fragment);
    }

    updateCheckbox(id, checked) {
        const checkbox = document.getElementById(`checkbox-${id}`);
        if (checkbox && checkbox.checked !== checked) {
            checkbox.checked = checked;
        }
    }

    getRenderedCount() {
        return this.container.querySelectorAll('.checkbox-item').length;
    }

    clear() {
        this.container.innerHTML = '';
    }

    isElementInViewport(element, buffer = 3000) {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= -buffer &&
            rect.left >= -buffer &&
            rect.bottom <= window.innerHeight + buffer &&
            rect.right <= window.innerWidth + buffer
        );
    }

    cleanupOffscreenElements() {
        const elements = Array.from(
            this.container.querySelectorAll('.checkbox-item')
        );
        const inViewport = elements.filter(el => this.isElementInViewport(el));

        if (
            elements.length > inViewport.length + 500 &&
            elements.length - inViewport.length > 1000
        ) {
            const toRemove = elements.slice(0, elements.length - inViewport.length - 500);
            toRemove.forEach(el => el.remove());
            return toRemove.length;
        }
        return 0;
    }
}

// ============ UI CONTROLLER ============
class UIController {
    constructor() {
        this.countDisplay = document.getElementById('count-display');
        this.progressBar = document.getElementById('scroll-progress');
        this.loadingIndicator = document.getElementById('loading');
        this.scrollTopBtn = document.getElementById('scrollTopBtn');
        this.scrollBottomBtn = document.getElementById('scrollBottomBtn');
        this.remainingDisplay = document.getElementById('remaining-checkboxes');

        this.updateCountDisplay = debounce(
            this.updateCountDisplay.bind(this),
            100
        );
        this.updateScrollButtons = debounce(this.updateScrollButtons.bind(this), 50);

        this.updateAlertCount = 0;
    }

    updateCountDisplay(checkedCount, totalCount) {
        if (!this.countDisplay || !this.remainingDisplay) return;
        this.countDisplay.textContent = checkedCount.toLocaleString();
        const remaining = totalCount - checkedCount;
        this.remainingDisplay.textContent = remaining.toLocaleString();

        this.updateAlertCount++;
        if (this.updateAlertCount === 200) {
            alert('chill, lol');
        } else if (this.updateAlertCount === 1000) {
            alert("umm... don't you have anything better to do?");
        }
    }

    updateScrollProgress() {
        if (!this.progressBar) return;
        const scrollHeight = document.body.scrollHeight - window.innerHeight;
        const scrollPercent = scrollHeight > 0 ? (window.scrollY / scrollHeight) * 100 : 0;
        this.progressBar.style.width = Math.min(100, scrollPercent) + '%';
    }

    updateScrollButtons(isAutoScrolling) {
        if (window.scrollY > 300) {
            this.scrollTopBtn?.removeAttribute('hidden');
        } else {
            this.scrollTopBtn?.setAttribute('hidden', 'true');
        }

        const isNearBottom =
            window.scrollY + window.innerHeight >= document.body.scrollHeight - 500;
        if (!isNearBottom) {
            this.scrollBottomBtn?.removeAttribute('hidden');
        } else if (!isAutoScrolling) {
            this.scrollBottomBtn?.setAttribute('hidden', 'true');
        }

        this.updateScrollProgress();
    }

    setLoading(isLoading) {
        if (this.loadingIndicator) {
            isLoading
                ? this.loadingIndicator.removeAttribute('hidden')
                : this.loadingIndicator.setAttribute('hidden', 'true');
        }
    }

    onScrollTopClick(callback) {
        this.scrollTopBtn?.addEventListener('click', callback);
    }

    onScrollBottomClick(callback) {
        this.scrollBottomBtn?.addEventListener('click', callback);
    }

    scrollToTop() {
        window.scrollTo({ top: 0, behavior: 'auto' });
    }

    scrollToBottom() {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
    }

    startAutoScroll(onScroll) {
        if (this.scrollBottomBtn) {
            this.scrollBottomBtn.setAttribute('disabled', 'true');
            this.scrollBottomBtn.textContent = 'Stop (■)';
        }
        const interval = setInterval(onScroll, 800);
        return interval;
    }

    stopAutoScroll() {
        if (this.scrollBottomBtn) {
            this.scrollBottomBtn.textContent = 'Bottom ↓';
            this.scrollBottomBtn.removeAttribute('disabled');
        }
    }

    onScroll(callback) {
        window.addEventListener('scroll', throttle(callback, 100));
    }

    onWheel(callback) {
        window.addEventListener('wheel', callback, { passive: true });
    }

    onKeydown(callback) {
        window.addEventListener('keydown', callback);
    }

    onBeforeUnload(callback) {
        window.addEventListener('beforeunload', callback);
    }
}

// ============ CHECKBOX APP ============
class CheckboxApp {
    constructor() {
        console.log('[APP] Constructor - initializing...');
        this.state = new StateManager();
        console.log('[APP] StateManager created');
        this.network = new NetworkService();
        console.log('[APP] NetworkService created');
        this.render = new RenderEngine('#checkbox-container');
        console.log('[APP] RenderEngine created');
        this.ui = new UIController();
        console.log('[APP] UIController created');
        this.scrollInterval = null;
        console.log('[APP] Constructor complete');
    }

    async initialize() {
        console.log('[APP] initialize() started');
        try {
            this.setupEventListeners();
            console.log('[APP] Event listeners setup');
            
            this.renderInitialBatch();
            console.log('[APP] Initial batch rendered');
            
            await this.loadDatabaseState();
            console.log('[APP] Database state loaded');
            
            this.subscribeToUpdates();
            console.log('[APP] Subscribed to updates');
        } catch (error) {
            console.error('[APP] Error during initialize:', error);
            throw error;
        }
    }

    setupEventListeners() {
        this.ui.onScrollTopClick(() => this.handleScrollTop());
        this.ui.onScrollBottomClick(() => this.handleScrollBottom());
        this.ui.onScroll(() => this.handleScroll());
        this.ui.onWheel(e => this.handleWheel(e));
        this.ui.onKeydown(e => this.handleKeydown(e));
        this.ui.onBeforeUnload(() => this.cleanup());
    }

    renderInitialBatch() {
        const initialBatch = CONFIG.batchSize * 2;
        this.render.renderBatch(1, initialBatch, this.state.data.checkboxStates, (id, checked) =>
            this.onCheckboxChange(id, checked)
        );
        this.state.data.renderedCount = initialBatch;
        this.state.data.lastId = initialBatch;
    }

    async loadDatabaseState() {
        this.ui.setLoading(true);
        const docs = [];
        let offset = 0;
        const limit = 1000;
        let hasMore = true;

        while (hasMore) {
            const batch = await this.network.fetchCheckboxStates(limit, offset);
            if (batch.length === 0) break;

            batch.forEach(doc => {
                this.state.data.checkboxStates[doc.id] = doc.state;
            });

            docs.push(...batch);
            hasMore = batch.length === limit;
            offset += limit;
        }

        this.state.recalculateCount();
        this.ui.updateCountDisplay(this.state.data.checkedCount, CONFIG.numCheckboxes);
        this.ui.setLoading(false);
        this.state.markRangeLoaded(0, CONFIG.numCheckboxes);
    }

    subscribeToUpdates() {
        this.network.subscribeToUpdates((id, checked) => {
            this.state.updateCheckboxState(id, checked);
            this.render.updateCheckbox(id, checked);
            this.ui.updateCountDisplay(this.state.data.checkedCount, CONFIG.numCheckboxes);
        });
    }

    onCheckboxChange(id, checked) {
        this.state.updateCheckboxState(id, checked);
        this.state.addPendingUpdate(id, checked);
        this.ui.updateCountDisplay(this.state.data.checkedCount, CONFIG.numCheckboxes);

        if (this.state.data.pendingUpdates.size >= CONFIG.maxPendingUpdates) {
            this.flushPendingUpdates();
        } else {
            this.debouncedFlush();
        }
    }

    debouncedFlush = debounce(() => this.flushPendingUpdates(), CONFIG.updateBatchDelay);

    async flushPendingUpdates() {
        if (!this.state.hasPendingUpdates()) return;
        const updates = this.state.getPendingUpdates();
        await this.network.flushUpdates(updates);
    }

    handleScroll() {
        this.loadMoreCheckboxes();
        this.ui.updateScrollButtons(this.state.data.isAutoScrolling);
    }

    loadMoreCheckboxes() {
        if (this.state.data.ticking) return;

        this.state.data.ticking = true;
        requestAnimationFrame(() => {
            const scrollPosition = window.scrollY + window.innerHeight;
            const containerHeight = this.render.container.clientHeight;

            // Load more if approaching bottom
            if (scrollPosition >= containerHeight - 1000 &&
                this.state.data.renderedCount < CONFIG.numCheckboxes
            ) {
                const start = this.state.data.renderedCount + 1;
                const end = Math.min(
                    this.state.data.renderedCount + CONFIG.batchSize,
                    CONFIG.numCheckboxes
                );
                this.render.renderBatch(
                    start,
                    end,
                    this.state.data.checkboxStates,
                    (id, checked) => this.onCheckboxChange(id, checked)
                );
                this.state.data.renderedCount = end;
            }

            // Cleanup off-screen elements
            if (window.scrollY < this.state.data.lastScrollY) {
                const removed = this.render.cleanupOffscreenElements();
                if (removed > 0) {
                    this.state.data.renderedCount -= removed;
                }
            }

            this.state.data.lastScrollY = window.scrollY;
            this.state.data.ticking = false;
        });
    }

    handleScrollTop() {
        if (this.state.data.isAutoScrolling) {
            this.stopAutoScroll();
        } else {
            this.ui.scrollToTop();
        }
    }

    handleScrollBottom() {
        if (this.state.data.isAutoScrolling) {
            this.stopAutoScroll();
        } else {
            this.startAutoScroll();
        }
    }

    startAutoScroll() {
        this.state.data.isAutoScrolling = true;
        this.scrollInterval = this.ui.startAutoScroll(() => this.ui.scrollToBottom());
    }

    stopAutoScroll() {
        this.state.data.isAutoScrolling = false;
        if (this.scrollInterval) {
            clearInterval(this.scrollInterval);
            this.scrollInterval = null;
        }
        this.ui.stopAutoScroll();
    }

    handleWheel(event) {
        if (this.state.data.isAutoScrolling && event.deltaY < 0) {
            this.stopAutoScroll();
        }
    }

    handleKeydown(event) {
        if (event.code === 'Home') {
            event.preventDefault();
            this.handleScrollTop();
        } else if (event.code === 'End') {
            event.preventDefault();
            this.handleScrollBottom();
        }
    }

    async cleanup() {
        await this.flushPendingUpdates();
        this.stopAutoScroll();
    }
}

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const app = new CheckboxApp();
        await app.initialize();
        window.app = app; // For debugging
        console.log('✓ CheckboxApp initialized successfully');
    } catch (error) {
        console.error('✗ Failed to initialize CheckboxApp:', error);
    }
});
