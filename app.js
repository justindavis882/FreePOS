// --- REGISTER SERVICE WORKER ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered!', reg))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithCustomToken, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    initializeFirestore, 
    persistentLocalCache, 
    persistentMultipleTabManager,
    collection, addDoc, doc, updateDoc, deleteDoc, getDocs, onSnapshot, getDoc, setDoc, query, orderBy, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-functions.js";

const isCanvasEnv = typeof __firebase_config !== 'undefined';
const firebaseConfig = {
    apiKey: "AIzaSyD0I8p3nM-oT_Qbzax2eialWeoMOIQt4OI",
    authDomain: "freepos-69379.firebaseapp.com",
    projectId: "freepos-69379",
    storageBucket: "freepos-69379.firebasestorage.app",
    messagingSenderId: "194928732424",
    appId: "1:194928732424:web:630d30282fabe4d74aa4bd",
    measurementId: "G-8D0F2HYN8T"
};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'freepos';

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
  })
});
const functions = getFunctions(app);
const googleProvider = new GoogleAuthProvider();

// Replace with your Stripe Publishable Key
const stripe = Stripe('pk_live_51TnUXjPbXPCVl4ZEPDTtraw9gRiPRh0Mt4QydxGlXemx3zdLblDYK5vz5Uta87kmMdGILk23zQo62UxtrpvDewCb00aKGrplRH'); 
const elements = stripe.elements();

// Style it to match the gritty FreePOS vibe
const cardElement = elements.create('card', {
  style: {
    base: {
      color: '#1a1a1a',
      fontFamily: '"Courier New", Courier, monospace',
      fontSize: '16px',
      '::placeholder': { color: '#666' }
    },
    invalid: { color: '#ff4747' }
  }
});
cardElement.mount('#card-element');

// Handle the UI swap
document.getElementById('btnPayCardInit').onclick = () => {
    // Using your actual state variable: storeConfig
    if (storeConfig && storeConfig.stripe_account_id) {
        // STATE A: Stripe IS Connected -> Show the secure payment modal
        document.getElementById('checkoutOptionsPanel').style.display = 'none';
        document.getElementById('stripeElementsPanel').style.display = 'block';
        document.getElementById('checkoutModalTitle').innerText = `Charge $${currentTotal.toFixed(2)}`;
    } else {
        // STATE B: Stripe is NOT Connected -> Manual Ledger Mode
        const proceed = confirm("Stripe is not connected. Record this as a manual card payment? \n\n(Note: No actual funds will be processed. You must swipe the card on your own external terminal.)");
        
        if (proceed) {
            // Bypass the Stripe UI and log the sale as a manual entry
            finalizeSale('Card (External/Manual)'); 
        }
    }
};

document.getElementById('btnCancelStripe').onclick = () => {
    document.getElementById('stripeElementsPanel').style.display = 'none';
    document.getElementById('checkoutOptionsPanel').style.display = 'block';
    document.getElementById('checkoutModalTitle').innerText = 'Payment Method';
};

let currentUser = null;
let products = [];
let cart = [];
let storeConfig = {
    storeName: "FreePOS Store",
    receiptHeader: "Plain Text Receipt Layout",
    salesTaxRate: 0,
    activeAddons: [],
    subscriptionStatus: "free"
};
let unsubProducts = null;
let unsubStaff = null;
let pendingRefund = null;
let staffList = [];
let currentStaff = null;
let pendingModifierProduct = null;
let currentOrderTag = null;

// Dynamic Store Configuration
let STRIPE_PRICES = { addons: {}, supplies: {} };
let availableAddons = [];
let availableSupplies = [];

// Listen to the global catalog
onSnapshot(collection(db, 'system_store'), (snapshot) => {
    // Clear existing local arrays
    availableAddons = [];
    availableSupplies = [];
    STRIPE_PRICES.addons = {};
    STRIPE_PRICES.supplies = {};

    // Sort incoming items into their proper categories
    snapshot.forEach(docSnap => {
        const item = docSnap.data();
        const formattedItem = { id: item.systemId, name: item.name, desc: item.desc, price: item.price };

        if (item.type === 'addon') {
            availableAddons.push(formattedItem);
            STRIPE_PRICES.addons[item.systemId] = item.stripePriceId;
        } else if (item.type === 'supply') {
            availableSupplies.push(formattedItem);
            STRIPE_PRICES.supplies[item.systemId] = item.stripePriceId;
        }
    });

    if (document.getElementById('addOnsModal').style.display === 'flex') renderAddOns();
    if (document.getElementById('suppliesModal').style.display === 'flex') renderSupplies();

    renderLandingPage(); // Refresh the landing page with the latest data
});

let supplyCart = {};
let currentSubtotal = 0;
let currentTax = 0;
let currentTotal = 0;
let isKioskMode = false;

const getCollectionPath = (uid, col) => isCanvasEnv ? `artifacts/${appId}/users/${uid}/${col}` : `users/${uid}/${col}`;
const getDocPath = (uid, col, docId) => isCanvasEnv ? `artifacts/${appId}/users/${uid}/${col}/${docId}` : `users/${uid}/${col}/${docId}`;

// --- PWA INSTALL LOGIC ---
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('btnInstallPwa');
    if (installBtn) installBtn.style.display = 'block';
});

window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    const installBtn = document.getElementById('btnInstallPwa');
    if (installBtn) installBtn.style.display = 'none';
});

document.getElementById('btnInstallPwa').onclick = async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        document.getElementById('btnInstallPwa').style.display = 'none';
    }
};

// --- RENDER LANDING PAGE DYNAMICALLY ---
function renderLandingPage() {
    const addonsGrid = document.getElementById('lpAddonsGrid');
    const suppliesGrid = document.getElementById('lpSuppliesGrid');

    // Clear the grids first so we don't duplicate items if the database updates live
    if (addonsGrid) addonsGrid.innerHTML = '';
    if (suppliesGrid) suppliesGrid.innerHTML = '';

    // Render Add-ons
    availableAddons.forEach(a => {
        const card = document.createElement('div');
        card.className = 'lp-card';
        card.style.boxShadow = '6px 6px 0px #bae1ff';

        const title = document.createElement('h3');
        title.style.marginBottom = '10px';
        title.textContent = a.name;

        const desc = document.createElement('p');
        desc.style.cssText = 'margin-top: 0; color: #555;';
        desc.textContent = a.desc;

        const price = document.createElement('div');
        price.className = 'lp-card-price';
        price.style.color = '#43a047';
        price.textContent = `$${a.price.toFixed(2)} / mo`;

        card.appendChild(title);
        card.appendChild(desc);
        card.appendChild(price);
        if (addonsGrid) addonsGrid.appendChild(card);
    });

    // Render Supplies
    availableSupplies.forEach(s => {
        const card = document.createElement('div');
        card.className = 'lp-card';
        card.style.boxShadow = '6px 6px 0px #ffdfba';

        const title = document.createElement('h3');
        title.style.marginBottom = '10px';
        title.textContent = s.name;

        const desc = document.createElement('p');
        desc.style.cssText = 'margin-top: 0; color: #555;';
        desc.textContent = s.desc;

        const price = document.createElement('div');
        price.className = 'lp-card-price';
        price.style.color = '#e53935';
        price.textContent = `$${s.price.toFixed(2)}`;

        card.appendChild(title);
        card.appendChild(desc);
        card.appendChild(price);
        if (suppliesGrid) suppliesGrid.appendChild(card);
    });
}

renderLandingPage();

const initAuth = async () => {
    if (isCanvasEnv) {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
        } else {
            await signInAnonymously(auth);
        }
    }
};
initAuth();

onAuthStateChanged(auth, async (user) => {
    document.getElementById('loadingScreen').style.display = 'none';
    if (user) {
        currentUser = user;
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('appContainer').style.display = 'flex';

        const cfgRef = doc(db, getDocPath(user.uid, 'config', 'settings'));
        const cfgSnap = await getDoc(cfgRef);
        if (cfgSnap.exists()) storeConfig = { ...storeConfig, ...cfgSnap.data() };

        // THE ONBOARDING CHECK: If no profile exists, trap them in the modal
        if (!storeConfig.ownerName) {
            document.getElementById('onboardingModal').style.display = 'flex';
        }

        // AUTOMATED STRIPE SUBSCRIPTION LISTENER via Firebase Extension
        const subsRef = collection(db, getCollectionPath(user.uid, 'subscriptions'));
        onSnapshot(subsRef, (snapshot) => {
            let hasActiveSub = false;

            snapshot.forEach((subDoc) => {
                const subData = subDoc.data();
                if (subData.status === 'active' || subData.status === 'trialing') {
                    hasActiveSub = true;
                }
            });

            if (storeConfig.activeAddons?.length > 0) {
                if (hasActiveSub || storeConfig.adminBypass) {
                    storeConfig.subscriptionStatus = 'active';
                    document.getElementById('lockoutScreen').style.display = 'none';
                } else {
                    storeConfig.subscriptionStatus = 'past_due';
                    document.getElementById('lockoutScreen').style.display = 'flex';
                }
            } else {
                storeConfig.subscriptionStatus = 'free';
                document.getElementById('lockoutScreen').style.display = 'none';
            }

            // Apply layout settings based on sub status
            applyUIFeatureToggles();
        });

        document.getElementById('cfgStoreName').value = storeConfig.storeName || "";
        document.getElementById('cfgReceiptHeader').value = storeConfig.receiptHeader || "";
        document.getElementById('cfgSalesTax').value = storeConfig.salesTaxRate || 0;
        document.getElementById('taxRateDisplay').innerText = storeConfig.salesTaxRate || 0;

        loadProducts();
        if (storeConfig.activeAddons?.includes("shift_management")) loadStaff();
    } else {
        currentUser = null;
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('appContainer').style.display = 'none';
        if (unsubProducts) unsubProducts();
        if (unsubStaff) unsubStaff();
    }

    // Add this inside your onAuthStateChanged block (once we know who the user is)
    const urlParams = new URLSearchParams(window.location.search);
    const stripeAuthCode = urlParams.get('code');

    if (stripeAuthCode) {
        const finalizeStripe = httpsCallable(functions, 'finalizeStripeConnection');
        
        finalizeStripe({ code: stripeAuthCode }).then((result) => {
            alert("Stripe Connected Successfully! You can now accept cards.");
            
            // Update local state so they don't have to refresh
            storeConfig.stripe_account_id = result.data.accountId; 
            
            // Clean the URL so they don't accidentally re-submit the code
            window.history.replaceState({}, document.title, window.location.pathname);
        }).catch((error) => {
            alert("Error connecting Stripe: " + error.message);
        });
    }
});

// --- ONBOARDING LOGIC ---
document.getElementById('btnCompleteOnboarding').onclick = async () => {
    const ownerName = document.getElementById('onboardName').value.trim();
    const storeName = document.getElementById('onboardStoreName').value.trim();
    const phone = document.getElementById('onboardPhone').value.trim();

    if (!ownerName || !storeName) {
        return alert("Please provide your Name and Store Name to continue.");
    }

    const btn = document.getElementById('btnCompleteOnboarding');
    btn.innerText = "Configuring Terminal...";
    btn.disabled = true;

    // Merge the new profile data into the global config state
    storeConfig.ownerName = ownerName;
    storeConfig.storeName = storeName;
    storeConfig.phoneNumber = phone;
    storeConfig.accountEmail = currentUser.email; // Capture the email they used to sign in

    // Save to Firestore
    await setDoc(doc(db, getDocPath(currentUser.uid, 'config', 'settings')), storeConfig, { merge: true });

    // Update local UI
    document.getElementById('cfgStoreName').value = storeName;
    document.getElementById('onboardingModal').style.display = 'none';
};

function applyUIFeatureToggles() {
    const isActiveSub = storeConfig.subscriptionStatus === 'active';
    document.getElementById('openKioskBtn').style.display = (storeConfig.activeAddons?.includes("kiosk_mode") && isActiveSub) ? 'block' : 'none';
    document.getElementById('openSellGcBtn').style.display = (storeConfig.activeAddons?.includes("gift_cards") && isActiveSub) ? 'block' : 'none';
    document.getElementById('openOrderTagBtn').style.display = (storeConfig.activeAddons?.includes("table_markers") && isActiveSub) ? 'block' : 'none';
    document.getElementById('newProdModifiers').style.display = (storeConfig.activeAddons?.includes("modifiers_options") && isActiveSub) ? 'block' : 'none';

    const hasShiftMgt = storeConfig.activeAddons?.includes("shift_management") && isActiveSub;
    if (hasShiftMgt) {
        document.getElementById('openStaffBtn').style.display = 'block';
        document.getElementById('openTimecardsBtn').style.display = 'block';
        document.getElementById('btnLogout').style.display = 'none';
        document.getElementById('btnLockTerminal').style.display = 'block';
        document.getElementById('activeStaffDisplay').style.display = 'block';
        // Only lock on initial boot/refresh
        if (!currentStaff) lockTerminal();
    } else {
        document.getElementById('openStaffBtn').style.display = 'none';
        document.getElementById('openTimecardsBtn').style.display = 'none';
        document.getElementById('btnLogout').style.display = 'block';
        document.getElementById('btnLockTerminal').style.display = 'none';
        document.getElementById('activeStaffDisplay').style.display = 'none';
    }
}

document.getElementById('btnSignup').onclick = () => createUserWithEmailAndPassword(auth, document.getElementById('emailInput').value, document.getElementById('passwordInput').value).catch(err => alert(err.message));
document.getElementById('btnLogin').onclick = () => signInWithEmailAndPassword(auth, document.getElementById('emailInput').value, document.getElementById('passwordInput').value).catch(err => alert(err.message));
document.getElementById('btnGoogleAuth').onclick = () => signInWithPopup(auth, googleProvider).catch(err => alert(err.message));
document.getElementById('btnLogout').onclick = () => signOut(auth);
document.getElementById('btnSysLogoutPin').onclick = () => signOut(auth);

// --- PIN PAD & SHIFT MANAGEMENT LOGIC ---
function loadStaff() {
    if (!currentUser) return;
    const q = collection(db, getCollectionPath(currentUser.uid, 'staff'));
    unsubStaff = onSnapshot(q, (snapshot) => {
        staffList = [];
        snapshot.forEach(doc => staffList.push({ id: doc.id, ...doc.data() }));
        renderStaffList();
    });
}

window.addPinDigit = (num) => {
    const input = document.getElementById('pinInput');
    if (input.value.length < 4) input.value += num;
};
window.clearPin = () => document.getElementById('pinInput').value = '';

function lockTerminal() {
    currentStaff = null;
    document.getElementById('mainWorkspace').style.display = 'none';
    document.getElementById('pinScreen').style.display = 'flex';
    document.getElementById('activeStaffDisplay').innerText = "Terminal Locked";
    clearPin();
}
document.getElementById('btnLockTerminal').onclick = lockTerminal;

document.getElementById('btnPinUnlock').onclick = () => {
    const pin = document.getElementById('pinInput').value;
    if (staffList.length === 0) {
        alert("No staff configured. Bypassing PIN. Please configure staff in Settings.");
        unlockTerminal({ name: 'Owner (No PIN)' });
        return;
    }
    const staff = staffList.find(s => s.pin === pin);
    if (!staff) return alert("Invalid PIN.");
    unlockTerminal(staff);
};

function unlockTerminal(staffObj) {
    currentStaff = staffObj;
    document.getElementById('pinScreen').style.display = 'none';
    document.getElementById('mainWorkspace').style.display = 'flex';
    document.getElementById('activeStaffDisplay').innerText = `Cashier: ${staffObj.name}`;
    clearPin();
}

async function logTimecard(action) {
    const pin = document.getElementById('pinInput').value;
    const staff = staffList.find(s => s.pin === pin);
    if (!staff) return alert("Invalid PIN.");

    await addDoc(collection(db, getCollectionPath(currentUser.uid, 'timecards')), {
        staffId: staff.id,
        staffName: staff.name,
        action: action,
        timestamp: serverTimestamp()
    });
    alert(`${staff.name} successfully Clocked ${action.toUpperCase()}!`);
    clearPin();
}
document.getElementById('btnPinClockIn').onclick = () => logTimecard('In');
document.getElementById('btnPinClockOut').onclick = () => logTimecard('Out');

// Staff CRUD
document.getElementById('openStaffBtn').onclick = () => document.getElementById('staffModal').style.display = 'flex';
document.getElementById('btnSaveStaff').onclick = async () => {
    const name = document.getElementById('newStaffName').value.trim();
    const pin = document.getElementById('newStaffPin').value;
    if (!name || pin.length !== 4) return alert("Valid name and 4-digit PIN required.");
    if (staffList.find(s => s.pin === pin)) return alert("PIN already in use.");

    await addDoc(collection(db, getCollectionPath(currentUser.uid, 'staff')), { name, pin });
    document.getElementById('newStaffName').value = '';
    document.getElementById('newStaffPin').value = '';
};

window.deleteStaff = async (id) => {
    if (confirm("Remove this staff member?")) {
        await deleteDoc(doc(db, getDocPath(currentUser.uid, 'staff', id)));
    }
};

function renderStaffList() {
    const list = document.getElementById('staffListContainer'); list.innerHTML = '';
    staffList.forEach(s => {
        list.innerHTML += `<div class="crud-row">
<span>${s.name} (PIN: ${s.pin})</span>
<button class="btn" style="padding:2px 8px; background:#ffb3ba;" onclick="deleteStaff('${s.id}')">Del</button>
</div>`;
    });
}

document.getElementById('openTimecardsBtn').onclick = async () => {
    const q = query(collection(db, getCollectionPath(currentUser.uid, 'timecards')), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    const list = document.getElementById('timecardsListContainer'); list.innerHTML = '';

    snap.forEach(doc => {
        const data = doc.data();
        const d = data.timestamp ? data.timestamp.toDate().toLocaleString() : 'Processing';
        const actionColor = data.action === 'In' ? '#baffc9' : '#ffdfba';
        list.innerHTML += `<div style="border-bottom: 1px solid #ccc; padding: 10px; display:flex; justify-content:space-between;">
<div><strong>${data.staffName}</strong></div>
<div><span style="background: ${actionColor}; padding: 2px 5px; border: 1px solid #000;">Clock ${data.action}</span> - ${d}</div>
</div>`;
    });
    document.getElementById('timecardsModal').style.display = 'flex';
};

// --- GENERAL SETTINGS ---
document.getElementById('openSettingsBtn').onclick = () => document.getElementById('settingsModal').style.display = 'flex';
document.getElementById('btnSaveSettings').onclick = async () => {
    storeConfig.storeName = document.getElementById('cfgStoreName').value || "FreePOS Store";
    storeConfig.receiptHeader = document.getElementById('cfgReceiptHeader').value || "";
    storeConfig.salesTaxRate = parseFloat(document.getElementById('cfgSalesTax').value) || 0;

    await setDoc(doc(db, getDocPath(currentUser.uid, 'config', 'settings')), storeConfig);
    document.getElementById('taxRateDisplay').innerText = storeConfig.salesTaxRate;
    renderCart();
    document.getElementById('settingsModal').style.display = 'none';
};

// --- PREMIUM ADD-ONS & SUPPLIES CHECKOUT ---
document.getElementById('openAddOnsBtn').onclick = () => {
    document.getElementById('settingsModal').style.display = 'none';
    renderAddOns();
    document.getElementById('addOnsModal').style.display = 'flex';
};

document.getElementById('openSuppliesBtn').onclick = () => {
    document.getElementById('settingsModal').style.display = 'none';
    renderSupplies();
    document.getElementById('suppliesModal').style.display = 'flex';
};

function renderSupplies() {
    const list = document.getElementById('suppliesList'); list.innerHTML = '';
    let currentTotal = 0;
    availableSupplies.forEach(item => {
        const qty = supplyCart[item.id] || 0;
        currentTotal += qty * item.price;
        list.innerHTML += `
<div style="border: 2px solid var(--border); background: var(--bg); padding: 10px; display: flex; justify-content: space-between; align-items: center;">
<div><div style="font-weight: bold; font-size: 1.1rem;">${item.name}</div><div style="font-size: 0.8rem; color: #666;">${item.desc}</div><div style="font-weight: bold; margin-top: 5px; color: var(--accent);">$${item.price.toFixed(2)}</div></div>
<div style="display: flex; align-items: center; gap: 10px;">
<button class="btn" style="padding: 5px 10px; background: #ffb3ba;" onclick="updateSupply('${item.id}', -1)">-</button>
<span style="font-weight: bold; font-size: 1.2rem; min-width: 20px; text-align: center;">${qty}</span>
<button class="btn" style="padding: 5px 10px; background: #baffc9;" onclick="updateSupply('${item.id}', 1)">+</button>
</div>
</div>`;
    });
    document.getElementById('suppliesTotalDisplay').innerText = `$${currentTotal.toFixed(2)}`;
    const btnStripe = document.getElementById('btnCheckoutSupplies');
    btnStripe.disabled = currentTotal <= 0;
    btnStripe.style.opacity = currentTotal > 0 ? 1 : 0.5;
}

window.updateSupply = (id, delta) => {
    if (!supplyCart[id]) supplyCart[id] = 0;
    supplyCart[id] += delta;
    if (supplyCart[id] < 0) supplyCart[id] = 0;
    renderSupplies();
};

document.getElementById('btnConnectStripe').onclick = () => {
    // Replace with your actual Live or Test Client ID
    const STRIPE_CLIENT_ID = "ca_UnR2LiBuJIq1vzjbKCtlxlOsylrSO6Gq"; 
    // Where Stripe sends them back after setup
    const REDIRECT_URI = "https://free-pos.xyz"; 
    
    // Redirects the vendor to the Stripe onboarding flow
    const stripeConnectUrl = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${STRIPE_CLIENT_ID}&scope=read_write&redirect_uri=${REDIRECT_URI}`;
    
    window.location.assign(stripeConnectUrl);
};

// Live Stripe Extension Logic for Supplies Checkout
document.getElementById('btnCheckoutSupplies').onclick = async () => {
    const btn = document.getElementById('btnCheckoutSupplies');
    btn.innerText = "Connecting to Stripe...";
    btn.disabled = true;

    try {
        const lineItems = Object.entries(supplyCart).map(([id, qty]) => {
            return { price: STRIPE_PRICES.supplies[id], quantity: qty };
        }).filter(item => item.quantity > 0 && item.price);

        const checkoutSessionRef = await addDoc(collection(db, getCollectionPath(currentUser.uid, 'checkout_sessions')), {
            line_items: lineItems,
            mode: 'payment',
            success_url: window.location.origin,
            cancel_url: window.location.origin,
        });

        onSnapshot(checkoutSessionRef, (snap) => {
            const data = snap.data();
            if (data?.error) {
                alert(`Stripe Error: ${data.error.message}`);
                btn.innerText = "Checkout via Stripe";
                btn.disabled = false;
            }
            if (data?.url) {
                window.location.assign(data.url);
            }
        });
    } catch (error) {
        console.error(error);
        alert("Failed to initiate supplies checkout.");
        btn.innerText = "Checkout via Stripe";
        btn.disabled = false;
    }
};

function renderAddOns() {
    const list = document.getElementById('addOnsList'); list.innerHTML = '';
    let currentMonthly = 0;
    availableAddons.forEach(addon => {
        const isActive = storeConfig.activeAddons?.includes(addon.id);
        if (isActive) currentMonthly += addon.price;
        list.innerHTML += `
            <div style="border: 2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}; background: ${isActive ? '#fff0f0' : 'var(--bg)'}; padding: 10px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;" onclick="toggleAddon('${addon.id}')">
                <div>
                    <div style="font-weight: bold; font-size: 1.1rem;">${addon.name}</div>
                    <div style="font-size: 0.8rem; color: #666;">${addon.desc}</div>
                </div>
                <div style="font-weight: bold; font-size: 1.2rem;">${isActive ? '✓ ACTIVE' : `+$${addon.price.toFixed(2)}`}</div>
            </div>
        `;
    });
    document.getElementById('monthlyTotalDisplay').innerText = `$${currentMonthly.toFixed(2)}/mo`;

    const btnStripe = document.getElementById('btnCheckoutStripe');
    if (currentMonthly === 0) {
        btnStripe.innerText = "Revert to Free Tier"; btnStripe.style.background = "#ddd";
    } else if (storeConfig.subscriptionStatus === 'active') {
        btnStripe.innerText = "Update Stripe Subscription"; btnStripe.style.background = "#bae1ff";
    } else {
        btnStripe.innerText = "Subscribe via Stripe"; btnStripe.style.background = "#a8ebd1";
    }
}

window.toggleAddon = (addonId) => {
    if (!storeConfig.activeAddons) storeConfig.activeAddons = [];
    const index = storeConfig.activeAddons.indexOf(addonId);
    if (index > -1) storeConfig.activeAddons.splice(index, 1);
    else storeConfig.activeAddons.push(addonId);

    renderAddOns();
};

// Live Stripe Extension Logic for Subscription Checkout
document.getElementById('btnCheckoutStripe').onclick = async () => {
    const btn = document.getElementById('btnCheckoutStripe');

    // Handle downgrade to free tier locally
    if (btn.innerText === "Revert to Free Tier") {
        if (confirm("Are you sure? You will lose access to premium features immediately.")) {
            storeConfig.activeAddons = []; storeConfig.subscriptionStatus = 'free';
            await setDoc(doc(db, getDocPath(currentUser.uid, 'config', 'settings')), storeConfig);
            window.location.reload();
        }
        return;
    }

    btn.innerText = "Connecting to Stripe...";
    btn.disabled = true;

    try {
        // Pre-save the requested addons so UI knows what they want upon return
        await setDoc(doc(db, getDocPath(currentUser.uid, 'config', 'settings')), storeConfig);

        const lineItems = storeConfig.activeAddons.map(id => {
            return { price: STRIPE_PRICES.addons[id], quantity: 1 };
        }).filter(item => item.price);

        const checkoutSessionRef = await addDoc(collection(db, getCollectionPath(currentUser.uid, 'checkout_sessions')), {
            line_items: lineItems,
            mode: 'subscription',
            success_url: window.location.origin,
            cancel_url: window.location.origin,
        });

        onSnapshot(checkoutSessionRef, (snap) => {
            const data = snap.data();
            if (data?.error) {
                alert(`Stripe Error: ${data.error.message}`);
                btn.innerText = "Subscribe via Stripe";
                btn.disabled = false;
            }
            if (data?.url) {
                window.location.assign(data.url);
            }
        });
    } catch (error) {
        console.error(error);
        alert("Failed to initiate subscription checkout.");
        btn.innerText = "Subscribe via Stripe";
        btn.disabled = false;
    }
};

// Customer Billing Portal Logic (Replaces the pay balance simulation)
document.getElementById('btnPayBalance').onclick = async () => {
    const btn = document.getElementById('btnPayBalance');
    btn.innerText = "Opening Portal...";
    btn.disabled = true;

    try {
        const portalRef = await addDoc(collection(db, getCollectionPath(currentUser.uid, 'create_portal_links')), {
            return_url: window.location.origin
        });

        onSnapshot(portalRef, (snap) => {
            const data = snap.data();
            if (data?.error) {
                alert(`Portal Error: ${data.error.message}`);
                btn.innerText = "Update Billing (Pay Balance)";
                btn.disabled = false;
            }
            if (data?.url) {
                window.location.assign(data.url);
            }
        });
    } catch (error) {
        console.error(error);
        alert("Failed to open billing portal.");
        btn.innerText = "Update Billing (Pay Balance)";
        btn.disabled = false;
    }
};

document.getElementById('btnDemoteToFree').onclick = async () => {
    if (confirm("Are you sure? You will lose access to premium features immediately.")) {
        storeConfig.activeAddons = []; storeConfig.subscriptionStatus = 'free';
        await setDoc(doc(db, getDocPath(currentUser.uid, 'config', 'settings')), storeConfig);
        window.location.reload();
    }
};

// --- PRODUCT & CART LOGIC ---
function loadProducts() {
    if (!currentUser) return;
    const q = collection(db, getCollectionPath(currentUser.uid, 'products'));
    unsubProducts = onSnapshot(q, (snapshot) => {
        products = [];
        snapshot.forEach(doc => products.push({ id: doc.id, ...doc.data() }));
        document.getElementById('itemCountDisplay').innerText = products.length;
        renderGrid(); renderCrudList();
    });
}

document.getElementById('btnSaveProduct').onclick = async () => {
    const name = document.getElementById('newProdName').value;
    const price = parseFloat(document.getElementById('newProdPrice').value);
    const color = document.getElementById('newProdColor').value;
    const modifiers = document.getElementById('newProdModifiers').value;
    const id = document.getElementById('editProdId').value;

    if (!name || isNaN(price)) return alert("Information incomplete.");

    if (id) {
        await updateDoc(doc(db, getDocPath(currentUser.uid, 'products', id)), { name, price, color, modifiers });
    } else {
        const hasUnlimited = storeConfig.activeAddons?.includes("unlimited_inventory");
        if (products.length >= 25 && !hasUnlimited) return alert("Free limit reached! Open Settings to upgrade.");
        await addDoc(collection(db, getCollectionPath(currentUser.uid, 'products')), { name, price, color, modifiers });
    }
    clearProductForm();
};

window.editProduct = (id) => {
    const p = products.find(i => i.id === id);
    if (!p) return;
    document.getElementById('editProdId').value = p.id;
    document.getElementById('newProdName').value = p.name;
    document.getElementById('newProdPrice').value = p.price;
    document.getElementById('newProdColor').value = p.color;
    document.getElementById('newProdModifiers').value = p.modifiers || '';
    document.getElementById('btnCancelEdit').style.display = 'block';
};

window.deleteProduct = async (id) => {
    if (confirm("Confirm item deletion?")) {
        await deleteDoc(doc(db, getDocPath(currentUser.uid, 'products', id)));
        clearProductForm();
    }
};

function clearProductForm() {
    document.getElementById('editProdId').value = '';
    document.getElementById('newProdName').value = '';
    document.getElementById('newProdPrice').value = '';
    document.getElementById('newProdModifiers').value = '';
    document.getElementById('btnCancelEdit').style.display = 'none';
}
document.getElementById('btnCancelEdit').onclick = clearProductForm;

function renderGrid() {
    const grid = document.getElementById('productGrid'); grid.innerHTML = '';
    products.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'btn product-btn'; btn.style.backgroundColor = p.color;
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = p.name;
        const priceSpan = document.createElement('span');
        priceSpan.textContent = `$${p.price.toFixed(2)}`;
        btn.appendChild(nameSpan);
        btn.appendChild(priceSpan);

        btn.onclick = () => {
            if (p.modifiers && p.modifiers.trim() !== '') {
                openModifierModal(p);
            } else {
                const match = cart.find(i => i.id === p.id);
                match ? match.qty++ : cart.push({ ...p, qty: 1 });
                renderCart();
            }
        };
        grid.appendChild(btn);
    });
}

function renderCrudList() {
    const list = document.getElementById('crudProductList'); 
    list.innerHTML = '';
    
    // Corrected the loop variable to 'p'
    products.forEach(p => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'cart-item';

        // Use 'p' to access the product properties
        const nameSpan = document.createElement('span');
        nameSpan.textContent = `${p.name} ($${p.price.toFixed(2)})`; 

        const priceSpan = document.createElement('span');
        priceSpan.style.cssText = "display: flex; align-items: center; gap: 10px;";
        
        // Add the buttons using 'p.id'
        priceSpan.innerHTML = `
            <button class="btn" style="padding: 2px 8px; font-size: 0.8rem; background: #ffffba;" onclick="editProduct('${p.id}')">EDIT</button>
            <button class="btn" style="padding: 2px 8px; font-size: 0.8rem; background: #ffb3ba;" onclick="deleteProduct('${p.id}')">DEL</button>
        `;

        itemDiv.appendChild(nameSpan);
        itemDiv.appendChild(priceSpan);
        list.appendChild(itemDiv);
    });
}

// --- PRODUCT MODIFIERS LOGIC ---
window.openModifierModal = (p) => {
    pendingModifierProduct = p;
    document.getElementById('modModalTitle').innerText = p.name;
    const list = document.getElementById('modList'); list.innerHTML = '';

    const mods = p.modifiers.split(',').map(m => m.trim()).filter(m => m !== '');
    mods.forEach(modStr => {
        let modName = modStr; let priceChange = 0;
        if (modStr.includes(':')) {
            const parts = modStr.split(':');
            modName = parts[0].trim();
            priceChange = parseFloat(parts[1]) || 0;
        }
        const priceText = priceChange ? ` (+$${priceChange.toFixed(2)})` : '';
        list.innerHTML += `<button class="btn" style="background: #bae1ff; padding: 15px; font-size: 1.1rem;" onclick="applyModifier('${modName}', ${priceChange})">${modName}${priceText}</button>`;
    });
    document.getElementById('modifierModal').style.display = 'flex';
};

window.applyModifier = (modName, priceChange) => {
    const p = pendingModifierProduct;
    const customId = p.id + '-' + modName.replace(/\s+/g, '-').toLowerCase();
    const finalPrice = p.price + priceChange;
    const finalName = `${p.name} - ${modName}`;

    const match = cart.find(i => i.id === customId);
    match ? match.qty++ : cart.push({ id: customId, name: finalName, price: finalPrice, color: p.color, qty: 1 });

    renderCart(); document.getElementById('modifierModal').style.display = 'none';
};

window.addBaseItem = () => {
    const p = pendingModifierProduct;
    const match = cart.find(i => i.id === p.id);
    match ? match.qty++ : cart.push({ ...p, qty: 1 });
    renderCart(); document.getElementById('modifierModal').style.display = 'none';
};

window.removeFromCart = (id) => {
    cart = cart.filter(item => item.id !== id);
    renderCart();
};

function renderCart() {
    const list = document.getElementById('cartList'); list.innerHTML = '';
    currentSubtotal = 0; let taxableSubtotal = 0;

    cart.forEach(item => {
        let itemTotal = item.price * item.qty;
        currentSubtotal += itemTotal;
        if (!item.isGiftCard) taxableSubtotal += itemTotal;

        list.innerHTML += `<div class="cart-item">
<span>${item.qty}x ${item.name}</span>
<span style="display: flex; align-items: center; gap: 10px;">$${itemTotal.toFixed(2)}
<button class="btn" style="padding: 2px 8px; font-size: 0.8rem; background: #ffb3ba;" onclick="removeFromCart('${item.id}')">X</button>
</span>
</div>`;
    });

    currentTax = taxableSubtotal * (storeConfig.salesTaxRate / 100);
    currentTotal = currentSubtotal + currentTax;

    document.getElementById('subtotalDisplay').innerText = `$${currentSubtotal.toFixed(2)}`;
    document.getElementById('taxDisplay').innerText = `$${currentTax.toFixed(2)}`;
    document.getElementById('totalDisplay').innerText = `$${currentTotal.toFixed(2)}`;
}

// --- QUICK RING, GIFT CARD & ORDER TAGS ---
document.getElementById('openOrderTagBtn').onclick = () => {
    document.getElementById('customOrderTagInput').value = '';
    document.getElementById('orderTagModal').style.display = 'flex';
    document.getElementById('customOrderTagInput').focus();
};

window.applyOrderTag = (tag) => {
    currentOrderTag = tag ? tag.trim() : null;
    const display = document.getElementById('orderTagDisplay');
    if (currentOrderTag) {
        display.innerText = `Tag: ${currentOrderTag}`;
        display.style.display = 'block';
    } else {
        display.style.display = 'none';
        display.innerText = '';
    }
    document.getElementById('orderTagModal').style.display = 'none';
};

document.getElementById('openQuickRingBtn').onclick = () => {
    document.getElementById('quickRingName').value = '';
    document.getElementById('quickRingPrice').value = '';
    document.getElementById('quickRingModal').style.display = 'flex';
    document.getElementById('quickRingPrice').focus();
};

document.getElementById('btnQuickRingAdd').onclick = () => {
    const name = document.getElementById('quickRingName').value || 'Custom Item';
    const price = parseFloat(document.getElementById('quickRingPrice').value);
    if (isNaN(price) || price <= 0) return alert("Please enter a valid price.");

    const customId = 'custom-' + name.replace(/\s+/g, '-').toLowerCase() + '-' + price;
    const match = cart.find(i => i.id === customId);
    match ? match.qty++ : cart.push({ id: customId, name: name, price: price, color: '#ffffba', qty: 1 });

    renderCart(); document.getElementById('quickRingModal').style.display = 'none';
};

document.getElementById('openSellGcBtn').onclick = () => {
    document.getElementById('gcLoadAmount').value = '';
    document.getElementById('gcScanUid').value = '';
    document.getElementById('sellGiftCardModal').style.display = 'flex';
    document.getElementById('gcLoadAmount').focus();
};

document.getElementById('btnActivateGiftCard').onclick = () => {
    const amount = parseFloat(document.getElementById('gcLoadAmount').value);
    const uid = document.getElementById('gcScanUid').value.trim();
    if (isNaN(amount) || amount <= 0) return alert("Please enter a valid amount.");
    if (!uid) return alert("Please scan or enter the Gift Card UID.");

    const customId = 'gc-load-' + uid;
    const match = cart.find(i => i.id === customId);
    if (match) match.price += amount;
    else cart.push({ id: customId, name: `Gift Card Load`, price: amount, color: '#bae1ff', qty: 1, isGiftCard: true, gcUid: uid });

    renderCart(); document.getElementById('sellGiftCardModal').style.display = 'none';
};

// --- KIOSK MODE LOGIC ---
document.getElementById('openKioskBtn').onclick = () => {
    if (cart.length > 0 && !confirm("Entering Kiosk Mode will clear the current cart. Proceed?")) return;
    cart = []; renderCart(); isKioskMode = true;

    document.getElementById('mainHeader').style.display = 'none';
    document.getElementById('openQuickRingBtn').style.display = 'none';
    document.getElementById('openSellGcBtn').style.display = 'none';
    document.getElementById('exitKioskBtn').style.display = 'block';

    document.getElementById('chargeBtn').innerText = '🖨️ Print Order Ticket';
    document.getElementById('voidBtn').innerText = 'Start Over';
    document.querySelector('.grid-section').style.flex = '3';
};

document.getElementById('exitKioskBtn').onclick = () => {
    if (!confirm("Staff: Exit Kiosk Mode?")) return;
    isKioskMode = false;

    document.getElementById('mainHeader').style.display = 'flex';
    document.getElementById('openQuickRingBtn').style.display = 'block';
    if (storeConfig.activeAddons?.includes("gift_cards")) document.getElementById('openSellGcBtn').style.display = 'block';
    document.getElementById('exitKioskBtn').style.display = 'none';

    document.getElementById('chargeBtn').innerText = 'Charge';
    document.getElementById('voidBtn').innerText = 'Void';
    document.querySelector('.grid-section').style.flex = '2';
    cart = []; renderCart();
};

// --- TRANSACTION PIPELINE ---
document.getElementById('chargeBtn').onclick = () => {
    if (cart.length === 0) return;
    if (isKioskMode) finalizeKioskOrder();
    else document.getElementById('checkoutModal').style.display = 'flex';
};

document.getElementById('voidBtn').onclick = () => {
    if (cart.length > 0 && confirm(isKioskMode ? "Start over?" : "Are you sure you want to void this ticket?")) {
        cart = []; window.appliedGiftCardUID = null; applyOrderTag(null); renderCart();
    }
};

async function finalizeKioskOrder() {
    const orderId = 'ORD-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    const txnPayload = { type: "Order", items: cart, subtotal: currentSubtotal, tax: currentTax, total: currentTotal, timestamp: new Date(), orderId: orderId };

    if (currentOrderTag) txnPayload.orderTag = currentOrderTag;

    triggerReceiptPrint(orderId, txnPayload);
    if (storeConfig.activeAddons?.includes("kitchen_printer")) {
        setTimeout(() => { triggerKitchenPrint(orderId, txnPayload); }, 1000); // Sequence the kitchen print
    }

    document.getElementById('kioskSuccessModal').style.display = 'flex';
    cart = []; applyOrderTag(null); renderCart();
    setTimeout(() => { document.getElementById('kioskSuccessModal').style.display = 'none'; }, 5000);
}

document.getElementById('btnPayCash').onclick = () => {
    document.getElementById('checkoutModal').style.display = 'none';
    document.getElementById('cashTotalDueDisplay').innerText = `Due: $${currentTotal.toFixed(2)}`;
    document.getElementById('cashTendered').value = '';
    document.getElementById('cashChangeDisplay').innerText = '$0.00';
    document.getElementById('cashTenderModal').style.display = 'flex';
    document.getElementById('cashTendered').focus();
};

document.getElementById('cashTendered').addEventListener('input', (e) => {
    const tendered = parseFloat(e.target.value) || 0;
    const change = tendered - currentTotal;
    document.getElementById('cashChangeDisplay').innerText = change >= 0 ? `$${change.toFixed(2)}` : '$0.00';
});

document.getElementById('btnCompleteCashSale').onclick = () => {
    const tendered = parseFloat(document.getElementById('cashTendered').value) || 0;
    if (tendered < currentTotal && tendered !== 0) return alert("Amount tendered is less than total due!");

    const finalTendered = tendered || currentTotal;
    const change = finalTendered - currentTotal;

    document.getElementById('cashTenderModal').style.display = 'none';
    finalizeSale('Cash', null, finalTendered, change);
};

document.getElementById('btnPayCard').onclick = () => finalizeSale('Card');

document.getElementById('btnPayGiftCard').onclick = async () => {
    const uid = prompt("Scan or enter Gift Card UID:");
    if (!uid) return;

    const gcRef = doc(db, getDocPath(currentUser.uid, 'gift_cards', uid));
    const gcSnap = await getDoc(gcRef);

    if (!gcSnap.exists()) return alert("Gift Card not found in the system.");
    const balance = gcSnap.data().balance;
    if (balance <= 0) return alert("This Gift Card has a $0.00 balance.");

    if (balance < currentTotal) {
        const customId = 'gc-pmt-' + uid;
        if (cart.find(i => i.id === customId)) return alert("This card is already applied to the ticket.");

        cart.push({ id: customId, name: `GC Payment (${uid.substring(0, 4)})`, price: -balance, color: '#ddd', qty: 1, isGiftCard: true, gcUid: uid });
        window.appliedGiftCardUID = uid;
        renderCart();
        document.getElementById('checkoutModal').style.display = 'none';
        return alert(`Partial payment applied! $${balance.toFixed(2)} deducted from ticket. Please pay the remaining balance.`);
    }

    await updateDoc(gcRef, { balance: balance - currentTotal, updatedAt: serverTimestamp() });
    finalizeSale('Store Credit', uid);
};

document.getElementById('btnSubmitStripePayment').onclick = async () => {
    const btn = document.getElementById('btnSubmitStripePayment');
    btn.innerText = "Processing...";
    btn.disabled = true;

    const createIntent = httpsCallable(functions, 'createPaymentIntent');
    
    try {
        // Convert the currentTotal (dollars) to cents for Stripe
        const amountInCents = Math.round(currentTotal * 100);
        
        // 1. Ask the backend for the client secret
        const intentResult = await createIntent({ amount: amountInCents });
        const clientSecret = intentResult.data.clientSecret;

        // 2. Tell the Stripe Element on the page to confirm the card payment
        const { paymentIntent, error } = await stripe.confirmCardPayment(clientSecret, {
            payment_method: {
                card: cardElement,
                billing_details: {
                    name: currentStaff ? currentStaff.name : 'Owner',
                },
            }
        });

        if (error) {
            document.getElementById('card-errors').innerText = error.message;
            btn.innerText = "Charge Card";
            btn.disabled = false;
        } else if (paymentIntent.status === 'succeeded') {
            // SUCCESS! Log the sale in FreePOS
            finalizeSale('Card (Stripe)');
            
            // Clean up the UI
            cardElement.clear();
            document.getElementById('stripeElementsPanel').style.display = 'none';
            document.getElementById('checkoutOptionsPanel').style.display = 'block';
            btn.innerText = "Charge Card";
            btn.disabled = false;
        }
    } catch (err) {
        document.getElementById('card-errors').innerText = err.message;
        btn.innerText = "Charge Card";
        btn.disabled = false;
    }
};

async function finalizeSale(method, creditUid = null, tendered = null, change = null) {
    if (window.appliedGiftCardUID && !creditUid) { method = 'Split'; creditUid = window.appliedGiftCardUID; }

    const txnPayload = {
        type: "Sale", items: cart, subtotal: currentSubtotal, tax: currentTax, total: currentTotal,
        method: method, timestamp: new Date(), staffName: currentStaff ? currentStaff.name : 'Owner'
    };

    if (creditUid) txnPayload.storeCreditUID = creditUid;
    if (tendered !== null) txnPayload.tendered = tendered;
    if (change !== null) txnPayload.change = change;
    if (currentOrderTag) txnPayload.orderTag = currentOrderTag;

    const docRef = await addDoc(collection(db, getCollectionPath(currentUser.uid, 'transactions')), {
        ...txnPayload, timestamp: serverTimestamp()
    });

    for (const item of cart) {
        if (item.isGiftCard && item.gcUid) {
            const gcRef = doc(db, getDocPath(currentUser.uid, 'gift_cards', item.gcUid));
            const gcSnap = await getDoc(gcRef);
            if (gcSnap.exists()) {
                await updateDoc(gcRef, { balance: gcSnap.data().balance + item.price, updatedAt: serverTimestamp() });
            } else {
                await setDoc(gcRef, { balance: item.price, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            }
        }
    }

    document.getElementById('checkoutModal').style.display = 'none';

    // Sequential Printing
    triggerReceiptPrint(docRef.id, txnPayload);
    if (storeConfig.activeAddons?.includes("kitchen_printer")) {
        setTimeout(() => { triggerKitchenPrint(docRef.id, txnPayload); }, 1000);
    }

    cart = []; window.appliedGiftCardUID = null; applyOrderTag(null); renderCart();
}

// --- 70s EASTER EGG LOGIC ---
let clickCount = 0;
let discoInterval = null;

// Find the <h2> inside the settings modal
const settingsHeader = document.querySelector('#settingsModal .modal-header h2');

if (settingsHeader) {
    settingsHeader.style.cursor = 'pointer'; // Give a tiny hint
    settingsHeader.onclick = () => {
        clickCount++;
        if (clickCount >= 5) {
            startDisco();
            clickCount = 0; // Reset
        }
        // Reset count if they don't click fast enough
        setTimeout(() => { clickCount = 0; }, 2000);
    };
}

window.startDisco = () => {
    document.getElementById('settingsModal').style.display = 'none';
    const modal = document.getElementById('discoModal');
    modal.style.display = 'flex';

    // Start the flashing background colors on the overlay
    let colors = ['#ff00ff', '#00ffff', '#ffff00', '#ff4747', '#4ade80'];
    let i = 0;
    discoInterval = setInterval(() => {
        modal.style.backgroundColor = colors[i];
        i = (i + 1) % colors.length;
    }, 300); // Changes color every 300ms
};

window.stopDisco = () => {
    document.getElementById('discoModal').style.display = 'none';
    clearInterval(discoInterval);
    document.getElementById('discoModal').style.backgroundColor = 'rgba(0,0,0,0.8)'; // Reset overlay
};

// --- PRINTING & REFUNDS ---
function triggerKitchenPrint(id, txn) {
    const area = document.getElementById('receiptPrintArea');
    let itemsHtml = '';

    txn.items.forEach(i => {
        if (!i.isGiftCard || i.price > 0) {
            itemsHtml += `<div style="font-size: 18px; font-weight: bold; margin-bottom: 5px; border-bottom: 2px solid #000; padding-bottom: 5px;">${i.qty}x ${i.name}</div>`;
        }
    });

    area.innerHTML = `
<div style="text-align:center; font-weight:bold; font-size: 24px; text-transform:uppercase; margin-bottom: 10px;">** PREP TICKET **</div>
<div class="receipt-line"></div>
<div>Date: ${txn.timestamp.toLocaleString()}</div>
<div style="font-size:12px;">ID: ${id}</div>
${txn.orderTag ? `<div style="font-weight:bold; font-size: 24px; text-align: center; margin: 15px 0; border: 4px solid #000; padding: 10px; text-transform: uppercase;">${txn.orderTag}</div>` : ''}
<div class="receipt-line"></div>
${itemsHtml}
<div style="text-align:center; margin-top:15px; font-size:12px;">[ End of Ticket ]</div>
`;
    setTimeout(() => { window.print(); }, 150);
}

function triggerReceiptPrint(id, txn) {
    const area = document.getElementById('receiptPrintArea');
    let itemsHtml = '';
    txn.items.forEach(i => { itemsHtml += `<div class="receipt-flex"><span>${i.qty}x ${i.name}</span><span>$${(i.price * i.qty).toFixed(2)}</span></div>`; });

    const isOrder = txn.type === 'Order';
    const headerText = isOrder ? "CUSTOMER ORDER TICKET" : storeConfig.storeName;
    const subHeaderText = isOrder ? "Please take this ticket to the register to pay." : storeConfig.receiptHeader;
    let creditSection = ''; let barcodeValue = null;

    if (isOrder) {
        creditSection = `<div class="receipt-line"></div><div style="text-align:center; font-weight:bold; padding:5px;">ORDER ID</div><div style="text-align:center;"><svg id="barcode-${id}"></svg></div>`;
        barcodeValue = txn.orderId;
    } else if (txn.storeCreditUID) {
        if (txn.type === 'Refund') {
            creditSection = `<div class="receipt-line"></div><div style="text-align:center; font-weight:bold; padding:5px;">STORE CREDIT ISSUED</div><div style="text-align:center;"><svg id="barcode-${id}"></svg></div>`;
            barcodeValue = txn.storeCreditUID;
        } else if (txn.type === 'Sale') {
            creditSection = `<div class="receipt-line"></div><div style="text-align:center; font-size:10px;">PAID WITH GC: ${txn.storeCreditUID}</div>`;
        }
    }

    area.innerHTML = `
<div style="text-align:center; font-weight:bold; text-transform:uppercase; font-size: ${isOrder ? '16px' : '12px'};">${headerText}</div>
<div style="text-align:center; font-size:10px; margin-bottom:5px;">${subHeaderText}</div>
<div class="receipt-line"></div>
<div>Date: ${txn.timestamp.toLocaleString()}</div>
${!isOrder ? `<div style="font-size:10px;">ID: ${id}</div><div style="font-weight:bold; margin: 5px 0;">TYPE: ${txn.type.toUpperCase()}</div><div style="font-size:10px;">Cashier: ${txn.staffName || 'Owner'}</div>` : ''}
${txn.orderTag ? `<div style="font-weight:bold; text-align: center; margin: 5px 0; border: 1px dashed #000; padding: 3px;">Tag: ${txn.orderTag}</div>` : ''}
<div class="receipt-line"></div>
${itemsHtml}
<div class="receipt-line"></div>
<div class="receipt-flex" style="font-size:12px;"><span>Subtotal:</span><span>$${(txn.subtotal || Math.abs(txn.total)).toFixed(2)}</span></div>
${txn.tax ? `<div class="receipt-flex" style="font-size:12px;"><span>Tax:</span><span>$${txn.tax.toFixed(2)}</span></div>` : ''}
<div class="receipt-flex" style="font-weight:bold; font-size:14px;"><span>TOTAL:</span><span>$${txn.total.toFixed(2)}</span></div>
${!isOrder ? `<div style="margin-top: 5px;">Method: ${txn.method}</div>` : ''}
${txn.tendered ? `<div style="font-size:10px;">Tendered: $${txn.tendered.toFixed(2)}</div>` : ''}
${txn.change !== undefined && txn.change !== null ? `<div style="font-size:10px;">Change: $${txn.change.toFixed(2)}</div>` : ''}
${creditSection}
<div style="text-align:center; margin-top:15px; font-size:10px;">[ ${isOrder ? 'Take to Register' : 'FreePOS Terminal'} ]</div>
`;

    if (barcodeValue && window.JsBarcode) JsBarcode(`#barcode-${id}`, barcodeValue, { width: 1.2, height: 40, fontSize: 12, margin: 0, displayValue: true });
    setTimeout(() => { window.print(); }, 150);
}

const executeRefund = async (methodType) => {
    if (!pendingRefund) return;
    const { id, total, items } = pendingRefund;

    document.getElementById('refundModal').style.display = 'none';
    document.getElementById('transactionsModal').style.display = 'none';

    let creditUid = null; let targetMethod = "Cash";
    if (methodType === "credit") {
        creditUid = "SC-" + Math.random().toString(36).substr(2, 9).toUpperCase();
        targetMethod = "Store Credit";
        await setDoc(doc(db, getDocPath(currentUser.uid, 'gift_cards', creditUid)), { balance: Math.abs(total), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }

    const refundPayload = { type: "Refund", items: items, total: -Math.abs(total), method: targetMethod, storeCreditUID: creditUid, timestamp: new Date(), staffName: currentStaff ? currentStaff.name : 'Owner' };
    const docRef = await addDoc(collection(db, getCollectionPath(currentUser.uid, 'transactions')), { ...refundPayload, timestamp: serverTimestamp() });

    pendingRefund = null;
    triggerReceiptPrint(docRef.id, refundPayload);
};

document.getElementById('btnRefundCash').onclick = () => executeRefund('cash');
document.getElementById('btnRefundCredit').onclick = () => executeRefund('credit');

document.getElementById('openProductsBtn').onclick = () => document.getElementById('productsModal').style.display = 'flex';
document.getElementById('openTxnsBtn').onclick = async () => {
    if (!currentUser) return;
    const q = query(collection(db, getCollectionPath(currentUser.uid, 'transactions')), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    const list = document.getElementById('txnList'); list.innerHTML = '';

    snap.forEach(doc => {
        const data = doc.data();
        const d = data.timestamp ? data.timestamp.toDate().toLocaleString() : 'Processing';
        const txnDataForView = { ...data, timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : new Date().toISOString() };
        const escData = encodeURIComponent(JSON.stringify(txnDataForView));
        const escItems = encodeURIComponent(JSON.stringify(data.items));

        list.innerHTML += `<div style="border-bottom: 2px dashed #000; padding: 12px 0; display:flex; justify-content:space-between; align-items:center;">
<div><strong>${d}</strong> [${data.type}]<br>Total: $${data.total.toFixed(2)} (${data.method})</div>
<div style="display: flex; gap: 5px;">
<button class="btn" style="background:#bae1ff; padding:5px 10px;" onclick="viewTransaction('${doc.id}', '${escData}')">View</button>
${data.type === 'Sale' ? `<button class="btn" style="background:#ffb3ba; padding:5px 10px;" onclick="initiateRefund('${doc.id}', ${data.total}, '${escItems}')">Refund</button>` : ''}
</div>
</div>`;
    });
    document.getElementById('transactionsModal').style.display = 'flex';
};

window.initiateRefund = (id, total, itemsJson) => {
    const items = JSON.parse(decodeURIComponent(itemsJson));
    pendingRefund = { id, total, items };
    document.getElementById('refundModal').style.display = 'flex';
};

window.viewTransaction = (id, txnJson) => {
    const txn = JSON.parse(decodeURIComponent(txnJson));
    txn.timestamp = new Date(txn.timestamp);
    const content = document.getElementById('txnDetailsContent');
    let itemsHtml = txn.items.map(i => `<div style="display: flex; justify-content: space-between;"><span>${i.qty}x ${i.name}</span><span>$${(i.price * i.qty).toFixed(2)}</span></div>`).join('');

    content.innerHTML = `
<div><strong>ID:</strong> ${id}</div>
<div><strong>Date:</strong> ${txn.timestamp.toLocaleString()}</div>
<div><strong>Type:</strong> ${txn.type}</div>
<div><strong>Method:</strong> ${txn.method}</div>
<div><strong>Cashier:</strong> ${txn.staffName || 'Owner'}</div>
${txn.orderTag ? `<div><strong style="color: var(--accent);">Tag:</strong> ${txn.orderTag}</div>` : ''}
${txn.tendered ? `<div><strong>Tendered:</strong> $${txn.tendered.toFixed(2)} (Change: $${txn.change.toFixed(2)})</div>` : ''}
${txn.storeCreditUID ? `<div><strong>Credit UID:</strong> ${txn.storeCreditUID}</div>` : ''}
<div style="border-bottom: 1px dashed #ccc; margin: 10px 0;"></div><strong>Items:</strong>${itemsHtml}
<div style="border-bottom: 1px dashed #ccc; margin: 10px 0;"></div>
<div style="display: flex; justify-content: space-between;"><span>Subtotal:</span> <span>$${(txn.subtotal || Math.abs(txn.total)).toFixed(2)}</span></div>
${txn.tax ? `<div style="display: flex; justify-content: space-between;"><span>Tax:</span> <span>$${txn.tax.toFixed(2)}</span></div>` : ''}
<div style="font-size: 1.2rem; display: flex; justify-content: space-between; margin-top: 5px;"><strong>Total:</strong> <strong>$${txn.total.toFixed(2)}</strong></div>
`;

    document.getElementById('btnReprintReceipt').onclick = () => triggerReceiptPrint(id, txn);

    const btnPrep = document.getElementById('btnReprintPrep');
    if (storeConfig.activeAddons?.includes("kitchen_printer")) {
        btnPrep.style.display = 'block';
        btnPrep.onclick = () => triggerKitchenPrint(id, txn);
    } else {
        btnPrep.style.display = 'none';
    }

    document.getElementById('txnDetailsModal').style.display = 'flex';
};
