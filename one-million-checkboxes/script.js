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
const usersCollectionId = '66830ef30011252083cb';
let lastRemCount = 0;
let userId = localStorage.getItem("userId");
const genRandomHex = size => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
let userActivity = null;
let userCheckedCount = 0;

async function subscribeToUpdates() {
    console.log('establishing websocket connection');
    await client.subscribe([`databases.${databaseId}.collections.${collectionId}.documents`], response => {
        const eventsArr = response.events[0].split('.');
        const actionPerformed = eventsArr[eventsArr.length - 1];
        response = Object(response);
        if (actionPerformed === 'delete') {
            checkboxStates[response.payload.id] = false;
        } else {
            checkboxStates[response.payload.id] = response.payload.state;
            // console.log(`${response.payload.id} state: ${checkboxStates[response.payload.id]}`);
        }
        checkedCount = Object.values(checkboxStates).filter((value) => value).length;
        updateCountDisplay();
        updateUI(true, response.payload.id, checkboxStates[response.payload.id]);
    });
}

// Function to fetch initial state from Appwrite
async function fetchStateFromAppwrite() {
    let ready = false;
    let docsProcessed = 0;
    let offset = 0;
    const limit = 1000; // The number of documents to fetch per request
    let hasMoreDocuments = true;

    try {
        while (hasMoreDocuments) {
            const response = await databases.listDocuments(
                databaseId,
                collectionId,
                [
                    Query.limit(limit),
                    Query.offset(offset)
                ]
            );

            response.documents.forEach(doc => {
                const id = Number(doc.id);
                checkboxStates[id] = doc.state;
                docsProcessed += 1;
            });

            // Update offset for the next batch
            offset += limit;

            // Check if we need to fetch more documents
            hasMoreDocuments = response.documents.length === limit;
        }
        lastRemCount = numCheckboxes - docsProcessed;
        checkedCount = Object.values(checkboxStates).filter((value) => value).length;
        updateCountDisplay();
        document.getElementById('loading').setAttribute("hidden", true);
        updateUI();
        ready = true;
        // console.log(`Documents processed: ${docsProcessed}`);
    } catch (error) {
        console.error('Error fetching initial checkbox states from Appwrite:', error);
    }
    return ready;
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
        // console.log('listener triggered');
        checkboxStates[id] = checkbox.checked;
        await updateStateInAppwrite(id, checkbox.checked); // Update Appwrite
        checkedCount = Object.values(checkboxStates).filter((value) => value).length;
        updateCountDisplay();
        // await updateUserActivity(id, checkbox.checked);
        // if (getRandomInt(1, 10) === 1) setInterval(toggleRandomCheckbox(id), (getRandomInt(3, 10) * 1000)); // 10% chance that bot will play with you.
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
let tempUpdate = 0;
let msgShown = false;
let msgShown2 = false;
function updateCountDisplay() {
    countDisplay.textContent = checkedCount.toLocaleString();
    const remaining = document.getElementById('remaining-checkboxes');
    const remainingCount = numCheckboxes - checkedCount;
    remaining.textContent = remainingCount.toLocaleString();
    if (lastRemCount < remainingCount) remaining.style.color = 'red';
    else remaining.style.color = 'green';
    tempUpdate += 1;
    if(tempUpdate > 200 && !msgShown) {
        alert('chill, lol');
        msgShown = true;
    }
    if (msgShown && !msgShown2 && tempUpdate > 1000) {
        alert('umm... don\'t you have anything better to do?');
        msgShown2 = true;
    }
    // document.getElementById('user-count-display').textContent = userCheckedCount;
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
                if (checkboxesToRemove > 20000) {
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

// Function to check if an element is in the viewport with buffer
function isElementInViewport(el) {
    const rect = el.getBoundingClientRect();
    const buffer = 10000; // Buffer in pixels

    return (
        rect.top >= -buffer &&
        rect.left >= -buffer &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) + buffer &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth) + buffer
    );
}


let lastScrollY = window.scrollY; // Variable to store last scroll position

// Event listener for scrolling
window.addEventListener('scroll', loadMoreCheckboxes);

// Initial setup to fetch initial state from Appwrite and start polling
document.addEventListener('DOMContentLoaded', function () {
    const ready = fetchStateFromAppwrite(); // Fetch initial state from Appwrite
    updateCountDisplay(); // Update count display on page load
    subscribeToUpdates(); // subscribe to websocket
    // trackUserActivity();
    if(ready) setInterval(toggleRandomCheckbox, (getRandomInt(getRandomInt(2, 5), getRandomInt(5, 10)) * 1000));
});

async function trackUserActivity() {
    if (!!userId) {
        userActivity = await databases.listDocuments(
            databaseId, 
            usersCollectionId, 
            [
                Query.equal('user_id', userId)
            ],
        );
        if(!!userActivity) {
            userActivity = Object(userActivity);
            userCheckedCount = (userActivity.documents[0].checked_boxes || []).length;
        }
    } else {
        userId = genRandomHex(20);
        localStorage.setItem("userId", userId);
        await databases.createDocument(databaseId, usersCollectionId, userId, {user_id: userId, checked_boxes: []});
        userActivity = await databases.listDocuments(
            databaseId, 
            usersCollectionId, 
            [
                Query.equal('user_id', userId)
            ],
        );
        // location.reload();
    }
}

let scrollInterval = undefined;
let scrolling = false;
function scrollToBottom() {
    window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth'
    });
    scrolling = true;
    const el = document.getElementById('scrollBtn');
    el.textContent = "Stop scrolling";
}

function invokeScrollInfinite() {
    const el = document.getElementById('scrollBtn');
    if (scrolling) {
        clearInterval(scrollInterval);
        scrolling = false;
        el.textContent = "Scroll to bottom";
    }
    else {
        el.textContent = "Please wait..."
        scrollInterval = setInterval(scrollToBottom, 1000);
    }
}

document.getElementById('scrollBtn').addEventListener("click", invokeScrollInfinite);

async function updateUserActivity(id, state) {
    if(!!userId && !!userActivity) {
        userActivity = Object(userActivity);
        let checkedBoxes = userActivity.documents[0].checked_boxes || []
        let res = checkedBoxes.find(e => e == id);
        if((!res && !state) || (res && !state)) {
            userCheckedCount -= 1;
            checkedBoxes = checkedBoxes.filter(function(item) {
                return item !== id
            });
        }
        if(!res && state) {
            userCheckedCount += 1;
            checkedBoxes.push(id);
        }
        await databases.updateDocument(databaseId, usersCollectionId, userId, {user_id: userId, checked_boxes: [...new Set(checkedBoxes)]});
    }
}

// Function to update UI after state changes
function updateUI(updateRender, id, state) {
    updateRender = updateRender || false;
    renderCheckboxes(1, 2000, updateRender, id, state);
}

// little bot activity to get essence of the site
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function toggleRandomCheckbox(id) {
    id = id || getRandomInt(getRandomInt(200, 500), getRandomInt(500, 1000));
    const randomId = `checkbox-${id}`;

    // Get the checkbox element by ID
    const checkbox = document.getElementById(randomId);

    // If the checkbox is found, toggle its checked state
    if (checkbox) {
        checkbox.checked = !checkbox.checked;
        // Create and dispatch the change event
        const event = new Event('change', { bubbles: true });
        checkbox.dispatchEvent(event);
    }
}