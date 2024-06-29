// Initialize Appwrite client and databases
const { Client, Databases, Query } = Appwrite;
const client = new Client();
client.setEndpoint('https://cloud.appwrite.io/v1').setProject(process.env.APPWRITE_API_KEY);
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
const databaseId = process.env.APPWRITE_DB_ID;
const collectionId = process.env.APPWRITE_COLLECTION_ID;

async function subscribeToUpdates() {
    console.log('establising websocket connection');
    await client.subscribe([`databases.${databaseId}.collections.${collectionId}.documents`], response => {
        console.log('websocket response:');
        response = Object(response);
        checkboxStates[response.payload.id] = response.payload.state;
        updateUI();
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
        checkedCount = response.documents.length;
        updateCountDisplay();

        // After fetching, update UI
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
        // console.log(checkboxStates);
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
            const payload = {id: id, state: state};
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
function renderCheckboxes(start, end) {
    // console.log(`Rendering checkboxes from ${start} to ${end}`);
    const fragment = document.createDocumentFragment();
    for (let i = start; i <= end && i <= numCheckboxes; i++) {
        if (!checkboxStates[i]) checkboxStates[i] = false; // Initialize state if not fetched
        fragment.appendChild(createCheckbox(i));
    }
    container.appendChild(fragment);
}

// Function to load more checkboxes as user scrolls
function loadMoreCheckboxes(start, endN) {
    if (!ticking) {
        ticking = true;
        setTimeout(() => {
            const scrollPosition = window.scrollY + window.innerHeight;
            const containerHeight = container.clientHeight;
            console.log(`Scroll position: ${scrollPosition}, Container height: ${containerHeight}`);

            if (scrollPosition >= containerHeight - 500) { // Adjusted the threshold
                console.log('Rendering additional checkboxes');
                const start = renderedCount + 1;
                const end = Number(endN) > 0 ? endN : renderedCount + batchSize;
                renderCheckboxes(start, end);
                renderedCount += Number(endN) > 0 ? endN : batchSize;
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
function updateUI() {
    container.innerHTML = null;
    renderCheckboxes(1, 2000);
}
