// ============ CONFIGURATION ============
const CONFIG = {
    numCheckboxes: 1000000,
    initialRenderCount: 1500,
    batchSize: 1000,
    itemSize: 28,
    itemGap: 8,
    viewportBufferRows: 8,
    apiBaseUrl: (window.CHECKBOX_API_BASE || 'http://127.0.0.1:8787').replace(/\/$/, ''),
    userCheckedStorageKey: 'one-million-checkboxes:user-checked',
    userPlusStorageKey: 'one-million-checkboxes:user-plus',
    userMinusStorageKey: 'one-million-checkboxes:user-minus',
};

// ============ STATE MANAGER ============
class StateManager {
    constructor() {
        this.checkboxStates = {}; // { id: boolean }
        this.checkedCount = 0;
        this.lastScrollY = 0;
        this.isAutoScrolling = false;
        this.pendingUpdates = new Map(); // { id: boolean }
        this.userCheckedIds = this.loadUserCheckedIds();
        this.userPlusCount = this.loadCounter(CONFIG.userPlusStorageKey);
        this.userMinusCount = this.loadCounter(CONFIG.userMinusStorageKey);
    }

    loadCounter(key) {
        const raw = localStorage.getItem(key);
        const parsed = parseInt(raw || '0', 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    }

    loadUserCheckedIds() {
        try {
            const raw = localStorage.getItem(CONFIG.userCheckedStorageKey);
            if (!raw) return new Set();
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return new Set();
            return new Set(parsed.map(id => parseInt(id, 10)).filter(Number.isFinite));
        } catch {
            return new Set();
        }
    }

    persistUserCheckedIds() {
        localStorage.setItem(
            CONFIG.userCheckedStorageKey,
            JSON.stringify(Array.from(this.userCheckedIds))
        );
        localStorage.setItem(CONFIG.userPlusStorageKey, String(this.userPlusCount));
        localStorage.setItem(CONFIG.userMinusStorageKey, String(this.userMinusCount));
    }

    setUserCheckedState(id, checked, wasChecked) {
        if (!wasChecked && checked) this.userPlusCount++;
        if (wasChecked && !checked) this.userMinusCount++;
        if (checked) this.userCheckedIds.add(id);
        else this.userCheckedIds.delete(id);
        this.persistUserCheckedIds();
    }

    getUserCheckedCount() {
        return this.userCheckedIds.size;
    }

    getUserDeltaCounts() {
        return { plus: this.userPlusCount, minus: this.userMinusCount };
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

// ============ BACKEND SERVICE (CLOUDFLARE WORKER API) ============
class BackendService {
    constructor() {
        this.baseUrl = CONFIG.apiBaseUrl;
        this.eventSource = null;
        this.isReady = false;
    }

    async initialize() {
        // Health check is best-effort; we keep UX usable even if it fails briefly.
        try {
            await this.apiFetch('/api/health', { method: 'GET' });
        } catch {
            // Continue; retries happen during normal requests.
        }
        this.isReady = true;
    }

    async apiFetch(path, options = {}) {
        const response = await fetch(`${this.baseUrl}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
        });

        if (!response.ok) {
            throw new Error(`Backend request failed: ${response.status}`);
        }

        return response;
    }

    async fetchAllCheckboxesIncremental(onBatch) {
        if (!this.isReady) throw new Error('Backend not initialized');

        const response = await this.apiFetch('/api/checked', { method: 'GET' });
        const payload = await response.json();
        const checkedIds = Array.isArray(payload?.checkedIds)
            ? payload.checkedIds.map(id => parseInt(id, 10)).filter(Number.isFinite)
            : [];

        if (checkedIds.length === 0) {
            return [];
        }

        const docs = checkedIds.map(id => ({ id, state: true }));

        for (let i = 0; i < docs.length; i += CONFIG.batchSize) {
            const batch = docs.slice(i, i + CONFIG.batchSize);
            if (batch.length > 0 && onBatch) {
                onBatch(batch);
            }
            // Yield control so main-thread rendering stays responsive.
            await new Promise(resolve => requestAnimationFrame(resolve));
        }

        return docs;
    }

    async saveCheckbox(id, checked) {
        if (!this.isReady) throw new Error('Backend not initialized');

        try {
            await this.apiFetch('/api/update', {
                method: 'POST',
                body: JSON.stringify({ id: parseInt(id, 10), checked: checked === true }),
            });
        } catch {
            // Keep UX responsive even if a network write fails.
        }
    }

    async saveMultiple(updates) {
        if (!this.isReady) throw new Error('Backend not initialized');

        if (updates.length === 0) {
            return;
        }

        try {
            await this.apiFetch('/api/batch', {
                method: 'POST',
                body: JSON.stringify({ updates }),
            });
        } catch {
            // Fallback to one-by-one writes if batch endpoint fails.
            const writes = updates.map(([id, checked]) => this.saveCheckbox(id, checked));
            await Promise.allSettled(writes);
        }
    }

    subscribeToChanges(callback) {
        if (!this.isReady) throw new Error('Backend not initialized');

        if (typeof EventSource === 'undefined') {
            return;
        }

        try {
            if (this.eventSource) {
                this.eventSource.close();
            }

            this.eventSource = new EventSource(`${this.baseUrl}/api/events`);

            this.eventSource.addEventListener('checkbox-update', event => {
                try {
                    const data = JSON.parse(event.data || '{}');
                    if (!Number.isFinite(data.id)) {
                        return;
                    }
                    callback(data.id, data.checked === true);
                } catch {
                    // Ignore malformed event payload.
                }
            });
        } catch {
            // Realtime stream can fail silently without blocking core usage.
        }
    }
}

// ============ RENDER ENGINE ============
class RenderEngine {
    constructor() {
        this.container = document.getElementById('checkbox-container');
        if (!this.container) throw new Error('Container #checkbox-container not found');
        this.columns = 1;
        this.itemPitch = CONFIG.itemSize + CONFIG.itemGap;
        this.totalRows = Math.ceil(CONFIG.numCheckboxes / this.columns);
        this.lastWindowStartRow = -1;
        this.lastWindowEndRow = -1;
    }

    recalculateLayout() {
        // Keep a tiny right-edge safety margin to avoid clipping the last column
        // from fractional layout/scrollbar rounding differences.
        const rawWidth = this.container.clientWidth || window.innerWidth;
        const safeWidth = Math.max(0, rawWidth - 2);
        this.columns = Math.max(1, Math.floor(safeWidth / this.itemPitch));
        this.totalRows = Math.ceil(CONFIG.numCheckboxes / this.columns);
        this.container.style.height = `${this.totalRows * this.itemPitch}px`;
        this.lastWindowStartRow = -1;
        this.lastWindowEndRow = -1;
    }

    getContainerTop() {
        return this.container.getBoundingClientRect().top + window.scrollY;
    }

    getScrollYForId(id) {
        const row = Math.floor((id - 1) / this.columns);
        return this.getContainerTop() + row * this.itemPitch;
    }

    renderVisibleWindow(checkboxStates, force = false) {
        if (!this.columns) this.recalculateLayout();

        const containerTop = this.getContainerTop();
        const maxViewportTop = Math.max(0, this.totalRows * this.itemPitch - window.innerHeight);
        const viewportTop = Math.min(maxViewportTop, Math.max(0, window.scrollY - containerTop));
        const viewportBottom = Math.min(
            this.totalRows * this.itemPitch,
            viewportTop + Math.max(window.innerHeight, this.itemPitch)
        );

        let startRow = Math.floor(viewportTop / this.itemPitch) - CONFIG.viewportBufferRows;
        let endRow = Math.ceil(viewportBottom / this.itemPitch) + CONFIG.viewportBufferRows;

        startRow = Math.max(0, Math.min(this.totalRows - 1, startRow));
        endRow = Math.max(0, Math.min(this.totalRows - 1, endRow));
        if (startRow > endRow) {
            startRow = endRow;
        }

        if (!force && startRow === this.lastWindowStartRow && endRow === this.lastWindowEndRow) {
            return;
        }

        const startId = startRow * this.columns + 1;
        const endId = Math.min(CONFIG.numCheckboxes, (endRow + 1) * this.columns);

        const parts = [];
        for (let id = startId; id <= endId; id++) {
            const index = id - 1;
            const row = Math.floor(index / this.columns);
            const col = index % this.columns;
            const checked = checkboxStates[id] ? ' checked' : '';
            parts.push(
                `<div class="checkbox-item" data-id="${id}" style="left:${col * this.itemPitch}px;top:${row * this.itemPitch}px;width:${this.itemPitch}px;height:${this.itemPitch}px;">` +
                `<input type="checkbox" class="form-check-input" id="checkbox-${id}"${checked}></div>`
            );
        }

        this.container.innerHTML = parts.join('');
        this.lastWindowStartRow = startRow;
        this.lastWindowEndRow = endRow;
    }

    updateCheckbox(id, isChecked) {
        const checkbox = document.getElementById(`checkbox-${id}`);
        if (checkbox) {
            checkbox.checked = isChecked;
        }
    }

    syncRenderedCheckboxes(checkboxStates) {
        this.renderVisibleWindow(checkboxStates);
    }

    getRenderedCount() {
        return this.container.querySelectorAll('input[type="checkbox"]').length;
    }

    flashCheckbox(id) {
        const target = document.getElementById(`checkbox-${id}`);
        if (!target) return;
        target.classList.add('jump-target');
        setTimeout(() => target.classList.remove('jump-target'), 700);
    }
}

// ============ UI CONTROLLER ============
class UIController {
    constructor() {
        this.countDisplay = document.getElementById('count-display');
        this.remainingDisplay = document.getElementById('remaining-checkboxes');
        this.userCountDisplay = document.getElementById('user-count-display');
        this.userPlusDisplay = document.getElementById('user-plus-count');
        this.userMinusDisplay = document.getElementById('user-minus-count');
        this.loadingIndicator = document.getElementById('loading');
        this.jumpLabel = document.querySelector('.jump-label');
        this.jumpInput = document.getElementById('jumpInput');
        this.jumpBtn = document.getElementById('jumpBtn');
        this.progressBar = document.getElementById('scroll-progress');
        this.whyBtn = document.getElementById('whyBtn');
        this.whyModal = document.getElementById('whyModal');
        this.whyBackdrop = document.getElementById('whyBackdrop');
        this.whyClose = document.getElementById('whyClose');
        this.whyPanel = this.whyModal?.querySelector('.why-modal-panel') || null;
        this.whyEscHandler = null;
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

    updateUserCount(userCheckedCount, userDelta = { plus: 0, minus: 0 }) {
        if (this.userCountDisplay) {
            this.userCountDisplay.textContent = userCheckedCount.toLocaleString();
        }
        if (this.userPlusDisplay) {
            this.userPlusDisplay.textContent = `+${userDelta.plus.toLocaleString()}`;
        }
        if (this.userMinusDisplay) {
            this.userMinusDisplay.textContent = `-${userDelta.minus.toLocaleString()}`;
        }
    }

    updateProgress() {
        if (!this.progressBar) return;
        const scrollHeight = document.body.scrollHeight - window.innerHeight;
        const scrollPercent = scrollHeight > 0 ? (window.scrollY / scrollHeight) * 100 : 0;
        this.progressBar.style.width = Math.min(100, scrollPercent) + '%';
    }

    setLoading(isLoading) {
        if (this.loadingIndicator) {
            isLoading
                ? this.loadingIndicator.removeAttribute('hidden')
                : this.loadingIndicator.setAttribute('hidden', 'true');
        }
    }

    getJumpTarget() {
        const raw = this.jumpInput?.value || '';
        const parsed = parseInt(raw, 10);
        if (!Number.isFinite(parsed)) return null;
        return Math.max(1, Math.min(CONFIG.numCheckboxes, parsed));
    }

    setJumpBusy(isBusy, percent = null) {
        if (this.jumpBtn) {
            this.jumpBtn.disabled = isBusy;
            this.jumpBtn.textContent = 'Go';
            this.jumpBtn.setAttribute('aria-busy', isBusy ? 'true' : 'false');
            this.jumpBtn.classList.toggle('jump-btn-loading', isBusy);
            if (isBusy && percent !== null) {
                this.jumpBtn.title = `Processing ${percent}%`;
            } else {
                this.jumpBtn.title = 'Jump to checkbox';
            }
        }

        if (this.jumpLabel) {
            if (isBusy && percent !== null) {
                this.jumpLabel.textContent = `Jump to # (${percent}%)`;
            } else {
                this.jumpLabel.textContent = 'Jump to #';
            }
        }

        if (this.jumpInput) {
            this.jumpInput.disabled = isBusy;
        }
    }

    onJumpSubmit(callback) {
        this.jumpBtn?.addEventListener('click', callback);
        this.jumpInput?.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                callback();
            }
        });
    }

    openWhyModal() {
        if (!this.whyModal) return;
        this.whyModal.removeAttribute('hidden');
        this.whyBtn?.setAttribute('aria-expanded', 'true');
        this.whyPanel?.focus();
    }

    closeWhyModal() {
        if (!this.whyModal) return;
        this.whyModal.setAttribute('hidden', 'true');
        this.whyBtn?.setAttribute('aria-expanded', 'false');
        this.whyBtn?.focus();
    }

    setupWhyModalEvents() {
        if (!this.whyModal || !this.whyBtn) return;

        this.whyBtn.addEventListener('click', () => this.openWhyModal());
        this.whyClose?.addEventListener('click', () => this.closeWhyModal());

        this.whyBackdrop?.addEventListener('click', () => this.closeWhyModal());

        this.whyEscHandler = event => {
            if (event.key === 'Escape' && !this.whyModal.hasAttribute('hidden')) {
                this.closeWhyModal();
            }
        };
        document.addEventListener('keydown', this.whyEscHandler);
    }
}

// ============ MAIN APPLICATION ============
class CheckboxApp {
    constructor() {
        this.state = new StateManager();
        this.backend = new BackendService();
        this.render = new RenderEngine();
        this.ui = new UIController();
        this.pendingFlushTimer = null;
        this.pendingVisibleRefresh = false;
    }

    async ensureInitialPaint(maxFrames = 24) {
        for (let i = 0; i < maxFrames; i++) {
            this.render.renderVisibleWindow(this.state.checkboxStates, true);
            if (this.render.getRenderedCount() > 0) {
                return true;
            }
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        return false;
    }

    scheduleVisibleRefresh() {
        if (this.pendingVisibleRefresh) {
            return;
        }

        this.pendingVisibleRefresh = true;
        requestAnimationFrame(() => {
            this.pendingVisibleRefresh = false;
            this.render.renderVisibleWindow(this.state.checkboxStates, true);
            this.ui.updateCount(this.state.checkedCount);
        });
    }

    async start() {
        try {
            this.ui.updateUserCount(this.state.getUserCheckedCount(), this.state.getUserDeltaCounts());

            // Initialize backend
            await this.backend.initialize();

            // Virtualized layout + first viewport render
            this.render.recalculateLayout();
            this.render.renderVisibleWindow(this.state.checkboxStates, true);

            // Force another render on next frame after full layout settles.
            await new Promise(resolve => requestAnimationFrame(resolve));
            this.render.renderVisibleWindow(this.state.checkboxStates, true);

            // Safety fallback: if first paint still missed, force one delayed repaint.
            if (this.render.getRenderedCount() === 0) {
                setTimeout(() => {
                    this.render.renderVisibleWindow(this.state.checkboxStates, true);
                    this.ui.updateProgress();
                }, 50);
            }
            
            // Setup event listeners
            this.setupEventListeners();

            // Startup guard: keep trying until the first viewport has real checkbox nodes.
            await this.ensureInitialPaint();
            
            // Load database state asynchronously but wait for it
            await this.loadDatabaseState();

            // Hide loading after initial state sync is done.
            this.ui.setLoading(false);

            // Re-check once after loading is hidden so first paint never depends on scroll.
            this.ensureInitialPaint(8);
            
            // Subscribe to real-time updates
            this.subscribeToLiveUpdates();

            // Ensure initial progress reflects current scroll
            this.ui.updateProgress();
        } catch (error) {
            this.ui.setLoading(false);
            alert('Error: ' + error.message);
        }
    }

    async loadDatabaseState() {
        try {
            await this.backend.fetchAllCheckboxesIncremental(batchDocs => {
                const updates = batchDocs.map(doc => [doc.id, doc.state === true]);
                this.state.setMultiple(updates);
                this.scheduleVisibleRefresh();
            });

            // Ensure final paint and count are in sync.
            this.render.syncRenderedCheckboxes(this.state.checkboxStates);
            this.ui.updateCount(this.state.checkedCount);
        } catch (error) {
            // Continue anyway - show empty state
        }
    }

    subscribeToLiveUpdates() {
        this.backend.subscribeToChanges((id, isChecked) => {
            id = parseInt(id, 10);
            if (Number.isNaN(id)) {
                return;
            }
            
            // Update state
            this.state.setState(id, isChecked);
            
            // Update UI if rendered
            this.render.updateCheckbox(id, isChecked);
            
            // Update count
            this.ui.updateCount(this.state.checkedCount);
        });
    }

    onCheckboxChange(event) {
        const checkbox = event.target;
        const id = parseInt(checkbox.id.replace('checkbox-', ''), 10);
        const isChecked = checkbox.checked;
        const wasChecked = this.state.checkboxStates[id] || false;
        
        // Update state
        this.state.setState(id, isChecked);
        this.state.setUserCheckedState(id, isChecked, wasChecked);
        this.state.addPendingUpdate(id, isChecked);
        
        // Update UI
        this.ui.updateCount(this.state.checkedCount);
        this.ui.updateUserCount(this.state.getUserCheckedCount(), this.state.getUserDeltaCounts());
        
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
        await this.backend.saveMultiple(updates);
    }

    onScroll() {
        this.render.renderVisibleWindow(this.state.checkboxStates);
        this.ui.updateProgress();
    }

    async jumpToCheckbox() {
        const targetId = this.ui.getJumpTarget();
        if (!targetId) return;

        this.ui.setJumpBusy(true, 0);
        try {
            const targetY = this.render.getScrollYForId(targetId);
            window.scrollTo({ top: Math.max(0, targetY - window.innerHeight * 0.42), behavior: 'auto' });

            // Let scroll settle, then render/flash target inside window.
            await new Promise(resolve => requestAnimationFrame(resolve));
            this.render.renderVisibleWindow(this.state.checkboxStates);
            this.render.flashCheckbox(targetId);

            this.ui.setJumpBusy(true, 100);
            this.ui.updateProgress();
        } finally {
            setTimeout(() => this.ui.setJumpBusy(false), 120);
        }
    }

    onResize() {
        this.render.recalculateLayout();
        this.render.renderVisibleWindow(this.state.checkboxStates, true);
        this.ui.updateProgress();
    }

    setupEventListeners() {
        // Checkboxes
        document.getElementById('checkbox-container').addEventListener('change', (e) => {
            if (e.target.type === 'checkbox') {
                this.onCheckboxChange(e);
            }
        }, { capture: true });
        
        // Jump control
        this.ui.onJumpSubmit(() => this.jumpToCheckbox());

        // Why modal
        this.ui.setupWhyModalEvents();
        
        // Scroll
        window.addEventListener('scroll', () => this.onScroll(), { passive: true });

        // Resize
        window.addEventListener('resize', () => this.onResize());
        
        // Cleanup on unload
        window.addEventListener('beforeunload', () => this.flushUpdates());
    }
}

// ============ INITIALIZATION ============
async function bootCheckboxApp() {
    if (window.__checkboxAppBooted) {
        return;
    }

    // Prevent browser restoring previous scroll position on refresh.
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }
    window.scrollTo({ top: 0, behavior: 'auto' });

    window.__checkboxAppBooted = true;
    const app = new CheckboxApp();
    await app.start();
    window.app = app; // For debugging
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootCheckboxApp, { once: true });
} else {
    bootCheckboxApp();
}
