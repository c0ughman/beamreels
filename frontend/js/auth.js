const CLERK_PUBLISHABLE_KEY = window.CLERK_PUBLISHABLE_KEY || '';

let clerkInstance = null;
let isClerkLoaded = false;

function loadClerkScript() {
    return new Promise((resolve, reject) => {
        if (window.Clerk) {
            resolve(window.Clerk);
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@latest/dist/clerk.browser.js';
        script.crossOrigin = 'anonymous';
        script.onload = () => resolve(window.Clerk);
        script.onerror = () => reject(new Error('Failed to load Clerk SDK'));
        document.head.appendChild(script);
    });
}

async function initClerk() {
    if (clerkInstance) {
        return clerkInstance;
    }

    if (!CLERK_PUBLISHABLE_KEY) {
        console.error('CLERK_PUBLISHABLE_KEY is not set');
        return null;
    }

    try {
        await loadClerkScript();
        if (!window.Clerk) {
            throw new Error('Clerk SDK failed to load');
        }
        clerkInstance = window.Clerk;
        await clerkInstance.load({
            publishableKey: CLERK_PUBLISHABLE_KEY
        });
        isClerkLoaded = true;
        return clerkInstance;
    } catch (err) {
        console.error('Failed to initialize Clerk:', err);
        return null;
    }
}

async function getClerk() {
    if (clerkInstance && isClerkLoaded) {
        return clerkInstance;
    }
    return await initClerk();
}

async function isAuthenticated() {
    const clerk = await getClerk();
    if (!clerk) return false;
    return !!clerk.user;
}

async function getUser() {
    const clerk = await getClerk();
    if (!clerk) return null;
    return clerk.user;
}

async function getUserId() {
    const user = await getUser();
    return user ? user.id : null;
}

async function getSessionToken() {
    const clerk = await getClerk();
    if (!clerk || !clerk.session) return null;
    try {
        return await clerk.session.getToken();
    } catch (err) {
        console.error('Failed to get session token:', err);
        return null;
    }
}

async function signOut() {
    const clerk = await getClerk();
    if (clerk) {
        await clerk.signOut();
        window.location.href = 'index.html';
    }
}

async function requireAuth(redirectUrl = 'login.html') {
    const clerk = await getClerk();
    if (!clerk) {
        window.location.href = redirectUrl;
        return false;
    }

    if (!clerk.user) {
        window.location.href = redirectUrl;
        return false;
    }

    return true;
}

async function redirectIfAuthenticated(redirectUrl = 'dashboard.html') {
    const clerk = await getClerk();
    if (clerk && clerk.user) {
        window.location.href = redirectUrl;
        return true;
    }
    return false;
}

async function authFetch(url, options = {}) {
    const token = await getSessionToken();

    const headers = {
        ...options.headers,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    return fetch(url, {
        ...options,
        headers
    });
}

function renderUserButton(containerId) {
    getClerk().then(clerk => {
        if (clerk && clerk.user) {
            const container = document.getElementById(containerId);
            if (container) {
                clerk.mountUserButton(container);
            }
        }
    });
}

window.BeamreelsAuth = {
    initClerk,
    getClerk,
    isAuthenticated,
    getUser,
    getUserId,
    getSessionToken,
    signOut,
    requireAuth,
    redirectIfAuthenticated,
    authFetch,
    renderUserButton
};
