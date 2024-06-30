// Initialize Appwrite client and databases
const { Client, Databases, Query } = Appwrite;
const client = new Client();
client.setEndpoint('https://cloud.appwrite.io/v1').setProject('667d0f2d001c4fce8b90');
const databases = new Databases(client);

// Number of checkboxes to create
const numCheckboxes = 1000000; // Adjust this number for actual use case
const batchSize = 500; // Number of checkboxes to render at a time
const batchDelay = 200; // Delay between batches in milliseconds
const container = document.getElementById('checkbox-container');
const countDisplay = document.getElementById('count-display'); // Element to display the count
let renderedCount = 0;
let ticking = false;
let checkboxStates = {}; // Object to store checkbox states
let checkedCount = 0; // Variable to store the count of checked checkboxes
let lastId = 0; // Variable to store the last used ID
const databaseId = '667d0f99001b691d76cc';
const collectionId = '667d0fa8000f64e4decc';

async function subscribeToUpdates() {
    console.log('establishing websocket connection');
    await client.subscribe([`databases.${databaseId}.collections.${collectionId}.documents`], response => {
        const eventsArr = response.events[0].split('.');
        const actionPerformed = eventsArr[eventsArr.length - 1];
        console.log(`[Websocket] State updated: ${actionPerformed}`);
        response = Object(response);
        const state = actionPerformed === 'delete' ? false : response.payload.state;
        if (actionPerformed === 'delete') {
            checkboxStates[response.payload.id] = false;
        } else {
            checkboxStates[response.payload.id] = response.payload.state;
            console.log(`${response.payload.id} state: ${checkboxStates[response.payload.id]}`);
        }
        checkedCount = Object.values(checkboxStates).filter((value) => value).length;
        updateCountDisplay();
        updateUI(true, response.payload.id, state);
    });
}

// Function to fetch initial state from Appwrite
async function fetchStateFromAppwrite() {
    let response = null;
    try {
        response = await databases.listDocuments(databaseId, collectionId);
        response.documents.forEach(doc => {
            const id = Number(doc.id);
            checkboxStates[id] = doc.state;
        });
        checkedCount = Object.values(checkboxStates).filter((value) => value).length;
        updateCountDisplay();
        updateUI();
    } catch (error) {
        console.error('Error fetching initial checkbox states from Appwrite:', error);
    }
}

// Function to create a checkbox element
function createCheckbox(id) {
    const checkboxDiv = document.createElement('div');
    checkboxDiv.className = 'checkbox-item';
    checkboxDiv.dataset.id = id; // Store the id in a data attribute for later removal

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'form-check-input';
    checkbox.id = `checkbox-${id}`; // Unique ID based on checkbox index

    // Set initial state from Appwrite or default to false
    checkbox.checked = checkboxStates[id] || false;

    checkbox.addEventListener('change', async () => {
        checkboxStates[id] = checkbox.checked;
        await updateStateInAppwrite(id, checkbox.checked); // Update Appwrite
        checkedCount = Object.values(checkboxStates).filter((value) => value).length;
        updateCountDisplay();
    });

    checkboxDiv.appendChild(checkbox);

    return checkboxDiv;
}

// Function to update state in Appwrite
async function updateStateInAppwrite(id, state) {
    const documentId = `id-${id}`;
    try {
        let result = null;
        if (state) {
            const existingDoc = await databases.listDocuments(
                databaseId, 
                collectionId, 
                [
                    Query.equal('$id', documentId)
                ],
            );
            const payload = { id: id, state: state };
            if (existingDoc.total > 0) {
                result = await databases.updateDocument(databaseId, collectionId, documentId, payload);
            } else {
                result = await databases.createDocument(databaseId, collectionId, documentId, payload);
            }   
        } else {
            result = await databases.deleteDocument(databaseId, collectionId, documentId);
        }
    } catch (error) {
        console.error(`(Safe) Error updating database for ${documentId}:`, error);
    }
}

// Function to update count display
function updateCountDisplay() {
    countDisplay.textContent = checkedCount;
}

// Function to render checkboxes
function renderCheckboxes(start, end, updateRender, id, state) {
    id = id || 0;
    state = state || false;
    updateRender = updateRender || false;
    const fragment = document.createDocumentFragment();
    if(updateRender) {
        const element = document.getElementById(`checkbox-${id}`);
        if(element) element.checked = state;
    } else {
        // console.log(`start: ${start}, end: ${end}`);
        for (let i = start; i <= end && i <= numCheckboxes; i++) {
            lastId++; // Increment the last used ID
            fragment.appendChild(createCheckbox(lastId));
        }
        container.appendChild(fragment);
    }
}

// Function to load more checkboxes as user scrolls
function loadMoreCheckboxes() {
    if (!ticking) {
        ticking = true;
        setTimeout(() => {
            const scrollPosition = window.scrollY + window.innerHeight;
            const containerHeight = container.clientHeight;

            if (scrollPosition >= containerHeight - 500) { // Adjusted the threshold
                console.log('Rendering additional checkboxes');
                const start = renderedCount + 1;
                const end = renderedCount + batchSize;
                renderCheckboxes(start, end, false);
                renderedCount += batchSize;
            }

            // Only remove checkboxes when scrolling up
            if (window.scrollY < lastScrollY) {
                const checkboxes = container.querySelectorAll('.checkbox-item');
                const checkboxesInView = Array.from(checkboxes).filter(checkbox => isElementInViewport(checkbox));
                const checkboxesToRemove = checkboxes.length - checkboxesInView.length - 2000;
                if (checkboxesToRemove > 0) {
                    console.log(`Removing ${checkboxesToRemove} checkboxes`);
                    for (let i = checkboxes.length - 1; i >= checkboxes.length - checkboxesToRemove; i--) {
                        container.removeChild(checkboxes[i]);
                    }
                    // Update renderedCount to reflect removed checkboxes
                    renderedCount -= checkboxesToRemove;
                    lastId = container.querySelectorAll('.checkbox-item').length;
                }
            }

            lastScrollY = window.scrollY; // Update last scroll position
            ticking = false;
        }, batchDelay);
    }
}

// Function to check if an element is in viewport
function isElementInViewport(el) {
    const rect = el.getBoundingClientRect();
    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
}

let lastScrollY = window.scrollY; // Variable to store last scroll position

// Event listener for scrolling
window.addEventListener('scroll', loadMoreCheckboxes);

// Initial setup to fetch initial state from Appwrite and start polling
document.addEventListener('DOMContentLoaded', function () {
    fetchStateFromAppwrite(); // Fetch initial state from Appwrite
    updateCountDisplay(); // Update count display on page load
    subscribeToUpdates(); // subscribe to websocket
});

// Function to update UI after state changes
function updateUI(updateRender, id, state) {
    updateRender = updateRender || false;
    renderCheckboxes(1, 2000, updateRender, id, state);
}
