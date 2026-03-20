// ============ CONFIGURATION ============
const CONFIG = {
    numCheckboxes: 1000000,
    initialRenderCount: 500,
    batchSize: 1000,
    databaseId: '667d0f99001b691d76cc',
    collectionId: '667d0fa8000f64e4decc',
    appwriteEndpoint: 'https://fra.cloud.appwrite.io/v1',
    appwriteProjectId: '667d0f2d001c4fce8b90',
};

// ============ STATE MANAGER ============
class StateManager {
    constructor() {
        this.checkboxStates = {}; // { id: boolean }
        this.checkedCount = 0;
        this.renderedCount = CONFIG.initialRenderCount;
        this.lastScrollY = 0;
        this.isAutoScrolling = false;
        this.pendingUpdates = new Map(); // { id: boolean }
    }

    setState(id, checked) {
        const was = this.checkboxStates[id] || false;
        this.checkboxStates[id] = checked;
        if (checked && !was) this.checkedCount++;
        else if (!checked && was) this.checkedCount--;
    }

    setMultiple(updates) {
        updates.forEach(([id, checked]) => this.setState(id, checked));
    }

    addPendingUpdate(id, checked) {
        this.pendingUpdates.set(id, checked);
    }

    getPendingUpdates() {
        const updates = Array.from(this.pendingUpdates.entries());
        this.pendingUpdates.clear();
        return updates;
    }

    hasPendingUpdates() {
        return this.pendingUpdates.size > 0;
    }
}

// ============ APPWRITE SERVICE ============
class AppwriteService {
    constructor() {
        this.client = null;
        this.databases = null;
        this.Query = null;
        this.isReady = false;
    }

    async initialize() {
        console.log('[APPWRITE] Initializing...');
        
        // Wait for Appwrite SDK to load
        if (typeof Appwrite === 'undefined') {
            throw new Error('Appwrite SDK not loaded');
        }

        const { Client, Databases, Query } = Appwrite;
        
        this.client = new Client()
            .setEndpoint(CONFIG.appwriteEndpoint)
            .setProject(CONFIG.appwriteProjectId);
        
        this.databases = new Databases(this.client);
        this.Query = Query;
        this.isReady = true;
        
        console.log('[APPWRITE] Initialized successfully');
    }

    async fetchAllCheckboxes() {
        console.log('[APPWRITE] Fetching all checkbox states...');
        if (!this.isReady) throw new Error('Appwrite not initialized');

        // Probe for total count with minimal data transfer
        const probe = await this.databases.listDocuments(
            CONFIG.databaseId,
            CONFIG.collectionId,
            [this.Query.limit(1)]
        );
        const total = probe.total;
        if (total === 0) {
            console.log('[APPWRITE] No checked boxes found');
            return [];
        }

        // Fire all page requests in parallel
        const pageCount = Math.ceil(total / 1000);
        console.log(`[APPWRITE] Fetching ${total} docs across ${pageCount} parallel requests...`);
        const requests = Array.from({ length: pageCount }, (_, i) =>
            this.databases.listDocuments(
                CONFIG.databaseId,
                CONFIG.collectionId,
                [this.Query.limit(1000), this.Query.offset(i * 1000)]
            )
        );

        const responses = await Promise.all(requests);
        const allDocs = responses.flatMap(r => r.documents);
        console.log(`[APPWRITE] Fetch complete: ${allDocs.length} checked boxes`);
        return allDocs;
    }

    async saveCheckbox(id, checked) {
        if (!this.isReady) throw new Error('Appwrite not initialized');

        const docId = `id-${id}`;
        
        try {
            if (checked) {
                // Try create, fall back to update if exists
                try {
                    await this.databases.createDocument(
                        CONFIG.databaseId,
                        CONFIG.collectionId,
                        docId,
                        { id: parseInt(id), state: true }
                    );
                } catch (error) {
                    // Document likely exists, update it
                    if (error.code === 409) {
                        await this.databases.updateDocument(
                            CONFIG.databaseId,
                            CONFIG.collectionId,
                            docId,
                            { state: true }
                        );
                    } else {
                        throw error;
                    }
                }
            } else {
                // Delete if unchecked
                try {
                    await this.databases.deleteDocument(
                        CONFIG.databaseId,
                        CONFIG.collectionId,
                        docId
                    );
                } catch (error) {
                    // Document doesn't exist, that's fine
                    if (error.code !== 404) throw error;
                }
            }
        } catch (error) {
            console.error(`[APPWRITE] Failed to save checkbox ${id}:`, error.message);
        }
    }

    async saveMultiple(updates) {
        console.log(`[APPWRITE] Saving ${updates.length} checkbox updates...`);
        
        const promises = updates.map(([id, checked]) => 
            this.saveCheckbox(id, checked)
        );
        
        await Promise.allSettled(promises);
        console.log('[APPWRITE] Batch save complete');
    }

    subscribeToChanges(callback) {
        if (!this.client) throw new Error('Appwrite not initialized');

        console.log('[APPWRITE] Subscribing to real-time updates...');
        
        try {
            this.client.subscribe(
                [`databases.${CONFIG.databaseId}.collections.${CONFIG.collectionId}.documents`],
                response => {
                    const event = response.events?.[0] || '';
                    const payload = response.payload || {};
                    const payloadId = payload.id ?? payload.$id?.replace(/^id-/, '');

                    if (!payloadId && !event.includes('delete')) {
                        console.warn('[APPWRITE] Ignoring realtime event with no checkbox id', response);
                        return;
                    }
                    
                    if (event.includes('create') || event.includes('update')) {
                        callback(payloadId, payload.state === true);
                    } else if (event.includes('delete')) {
                        callback(payloadId, false);
                    }
                }
            );
            console.log('[APPWRITE] Subscribed successfully');
        } catch (error) {
            console.error('[APPWRITE] Subscription failed:', error.message);
        }
    }
}

// ============ RENDER ENGINE ============
class RenderEngine {
    constructor() {
        this.container = document.getElementById('checkbox-container');
        if (!this.container) throw new Error('Container #checkbox-container not found');
        this.renderedIds = new Set();
    }

    renderRange(startId, endId, checkboxStates) {
        const parts = [];
        for (let i = startId; i <= endId && i <= CONFIG.numCheckboxes; i++) {
            if (!this.renderedIds.has(i)) {
                const checked = checkboxStates[i] ? ' checked' : '';
                parts.push(`<div class="checkbox-item" data-id="${i}"><input type="checkbox" class="form-check-input" id="checkbox-${i}"${checked}></div>`);
                this.renderedIds.add(i);
            }
        }
        if (parts.length > 0) {
            this.container.insertAdjacentHTML('beforeend', parts.join(''));
        }
    }

    updateCheckbox(id, isChecked) {
        const checkbox = document.getElementById(`checkbox-${id}`);
        if (checkbox) {
            checkbox.checked = isChecked;
        }
    }

    syncRenderedCheckboxes(checkboxStates) {
        this.renderedIds.forEach(id => {
            this.updateCheckbox(id, checkboxStates[id] || false);
        });
    }

    getRenderedCount() {
        return this.renderedIds.size;
    }
}

// ============ UI CONTROLLER ============
class UIController {
    constructor() {
        this.countDisplay = document.getElementById('count-display');
        this.remainingDisplay = document.getElementById('remaining-checkboxes');
        this.loadingIndicator = document.getElementById('loading');
        this.statusBanner = document.getElementById('status-banner');
        this.scrollTopBtn = document.getElementById('scrollTopBtn');
        this.scrollBottomBtn = document.getElementById('scrollBottomBtn');
        this.progressBar = document.getElementById('scroll-progress');
        this.scrollInterval = null;
    }

    setStatus(message, tone = 'pending') {
        if (!this.statusBanner) return;
        this.statusBanner.textContent = message;
        this.statusBanner.className = `status-banner status-banner-${tone}`;
    }

    updateCount(checkedCount) {
        if (this.countDisplay) {
            this.countDisplay.textContent = checkedCount.toLocaleString();
        }
        if (this.remainingDisplay) {
            const remaining = CONFIG.numCheckboxes - checkedCount;
            this.remainingDisplay.textContent = remaining.toLocaleString();
        }
    }

    updateProgress() {
        if (!this.progressBar) return;
        const scrollHeight = document.body.scrollHeight - window.innerHeight;
        const scrollPercent = scrollHeight > 0 ? (window.scrollY / scrollHeight) * 100 : 0;
        this.progressBar.style.width = Math.min(100, scrollPercent) + '%';
    }

    updateScrollButtons() {
        if (window.scrollY > 300) {
            this.scrollTopBtn?.removeAttribute('hidden');
        } else {
            this.scrollTopBtn?.setAttribute('hidden', 'true');
        }

        const isNearBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight - 500;
        if (!isNearBottom) {
            this.scrollBottomBtn?.removeAttribute('hidden');
        } else {
            this.scrollBottomBtn?.setAttribute('hidden', 'true');
        }
    }

    setLoading(isLoading) {
        if (this.loadingIndicator) {
            isLoading
                ? this.loadingIndicator.removeAttribute('hidden')
                : this.loadingIndicator.setAttribute('hidden', 'true');
        }
    }

    scrollToTop() {
        window.scrollTo({ top: 0, behavior: 'auto' });
    }

    scrollToBottom() {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
    }

    startAutoScroll() {
        if (this.scrollBottomBtn) {
            this.scrollBottomBtn.textContent = 'Stop (■)';
            this.scrollBottomBtn.setAttribute('aria-pressed', 'true');
        }
        this.scrollInterval = setInterval(() => this.scrollToBottom(), 800);
    }

    stopAutoScroll() {
        if (this.scrollInterval) {
            clearInterval(this.scrollInterval);
            this.scrollInterval = null;
        }
        if (this.scrollBottomBtn) {
            this.scrollBottomBtn.textContent = 'Bottom ↓';
            this.scrollBottomBtn.removeAttribute('aria-pressed');
        }
    }
}

// ============ MAIN APPLICATION ============
class CheckboxApp {
    constructor() {
        this.state = new StateManager();
        this.appwrite = new AppwriteService();
        this.render = new RenderEngine();
        this.ui = new UIController();
        this.pendingFlushTimer = null;
    }

    async start() {
        console.log('[APP] Starting application...');
        
        try {
            this.ui.setStatus('Connecting to Appwrite...', 'pending');

            // Initialize Appwrite
            await this.appwrite.initialize();
            this.ui.setStatus('Rendering initial checkboxes...', 'pending');
            
            // Render initial batch immediately
            this.render.renderRange(1, CONFIG.initialRenderCount, this.state.checkboxStates);
            this.state.renderedCount = CONFIG.initialRenderCount;
            console.log('[APP] Initial batch rendered');
            
            // Setup event listeners
            this.setupEventListeners();
            console.log('[APP] Event listeners setup');
            
            // Hide loading, start background tasks
            this.ui.setLoading(false);
            this.ui.setStatus('Fetching checked states...', 'pending');
            
            // Load database state asynchronously but wait for it
            await this.loadDatabaseState();
            console.log('[APP] Database state loaded');
            
            // Subscribe to real-time updates
            this.subscribeToLiveUpdates();
            console.log('[APP] Live updates subscribed');
            this.ui.setStatus('Connected and synced.', 'success');
            
            console.log('[APP] ✓ Application ready');
        } catch (error) {
            console.error('[APP] Fatal error:', error.message);
            this.ui.setLoading(false);
            this.ui.setStatus(`Startup failed: ${error.message}`, 'error');
            alert('Error: ' + error.message);
        }
    }

    async loadDatabaseState() {
        try {
            const docs = await this.appwrite.fetchAllCheckboxes();
            
            // Convert to state map
            const updates = docs.map(doc => [doc.id, doc.state === true]);
            this.state.setMultiple(updates);
            this.render.syncRenderedCheckboxes(this.state.checkboxStates);
            
            // Update UI
            this.ui.updateCount(this.state.checkedCount);
            
            console.log(`[APP] Loaded state: ${this.state.checkedCount} checked boxes`);
        } catch (error) {
            console.error('[APP] Failed to load database state:', error.message);
            this.ui.setStatus(`Loaded shell only. Data fetch failed: ${error.message}`, 'error');
            // Continue anyway - show empty state
        }
    }

    subscribeToLiveUpdates() {
        this.appwrite.subscribeToChanges((id, isChecked) => {
            id = parseInt(id, 10);
            if (Number.isNaN(id)) {
                console.warn('[APP] Ignoring realtime update with invalid id', id);
                return;
            }
            
            // Update state
            this.state.setState(id, isChecked);
            
            // Update UI if rendered
            this.render.updateCheckbox(id, isChecked);
            
            // Update count
            this.ui.updateCount(this.state.checkedCount);
            
            console.log(`[APP] Live update: checkbox ${id} = ${isChecked}`);
        });
    }

    onCheckboxChange(event) {
        const checkbox = event.target;
        const id = parseInt(checkbox.id.replace('checkbox-', ''), 10);
        const isChecked = checkbox.checked;
        
        // Update state
        this.state.setState(id, isChecked);
        this.state.addPendingUpdate(id, isChecked);
        
        // Update UI
        this.ui.updateCount(this.state.checkedCount);
        
        // Debounce save to database
        this.debouncedFlush();
    }

    debouncedFlush() {
        clearTimeout(this.pendingFlushTimer);
        this.pendingFlushTimer = setTimeout(() => {
            this.flushUpdates();
        }, 1000);
    }

    async flushUpdates() {
        if (!this.state.hasPendingUpdates()) return;
        
        const updates = this.state.getPendingUpdates();
        await this.appwrite.saveMultiple(updates);
    }

    onScroll() {
        // Load more checkboxes as user scrolls down
        const scrollY = window.scrollY + window.innerHeight;
        const thresholdY = document.body.scrollHeight - 2000;
        
        if (scrollY > thresholdY && this.state.renderedCount < CONFIG.numCheckboxes) {
            const nextStart = this.state.renderedCount + 1;
            const nextEnd = Math.min(this.state.renderedCount + CONFIG.batchSize, CONFIG.numCheckboxes);
            
            this.render.renderRange(nextStart, nextEnd, this.state.checkboxStates);
            this.state.renderedCount = nextEnd;
            
            console.log(`[APP] Rendered up to ${nextEnd}`);
        }
        
        // Update UI
        this.ui.updateProgress();
        this.ui.updateScrollButtons();
    }

    onScrollTopClick() {
        if (this.state.isAutoScrolling) {
            this.stopAutoScroll();
        } else {
            this.ui.scrollToTop();
        }
    }

    onScrollBottomClick() {
        if (this.state.isAutoScrolling) {
            this.stopAutoScroll();
        } else {
            this.startAutoScroll();
        }
    }

    startAutoScroll() {
        this.state.isAutoScrolling = true;
        this.ui.startAutoScroll();
    }

    stopAutoScroll() {
        this.state.isAutoScrolling = false;
        this.ui.stopAutoScroll();
    }

    onWheel(event) {
        // Stop auto-scroll if user scrolls up
        if (this.state.isAutoScrolling && event.deltaY < 0) {
            this.stopAutoScroll();
        }
    }

    onKeydown(event) {
        if (event.code === 'Home') {
            event.preventDefault();
            this.onScrollTopClick();
        } else if (event.code === 'End') {
            event.preventDefault();
            this.onScrollBottomClick();
        }
    }

    setupEventListeners() {
        // Checkboxes
        document.getElementById('checkbox-container').addEventListener('change', (e) => {
            if (e.target.type === 'checkbox') {
                this.onCheckboxChange(e);
            }
        }, { capture: true });
        
        // Scroll buttons
        this.ui.scrollTopBtn?.addEventListener('click', () => this.onScrollTopClick());
        this.ui.scrollBottomBtn?.addEventListener('click', () => this.onScrollBottomClick());
        
        // Scroll and wheel
        window.addEventListener('scroll', () => this.onScroll(), { passive: true });
        window.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
        
        // Keyboard
        window.addEventListener('keydown', (e) => this.onKeydown(e));
        
        // Cleanup on unload
        window.addEventListener('beforeunload', () => this.flushUpdates());
    }
}

// ============ INITIALIZATION ============
async function bootCheckboxApp() {
    if (window.__checkboxAppBooted) {
        return;
    }

    window.__checkboxAppBooted = true;
    console.log('[APP] DOM ready, starting...');
    const app = new CheckboxApp();
    await app.start();
    window.app = app; // For debugging
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootCheckboxApp, { once: true });
} else {
    bootCheckboxApp();
}
