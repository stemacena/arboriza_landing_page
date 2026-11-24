/* ==========================================================================
   ARBORIZA LANDING PAGE v2.0 — DASHBOARD EM TEMPO REAL + GUIA ADMINISTRATIVA
   Conecta ao banco oficial arboriza-bd respeitando privacidade (LGPD).
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup,
    signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    getFirestore,
    collection,
    collectionGroup,
    doc,
    setDoc,
    query,
    where,
    getDocs,
    onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- 1. CONFIGURAÇÃO (Preserva o link e banco oficiais do Arboriza) ---
const LINK_DA_PLATAFORMA = "https://arboriza.netlify.app";

const firebaseConfig = {
    apiKey: "AIzaSyDz5FUlrXC07aQDMJ4XzomdT4gkyKZVKgg",
    authDomain: "arboriza-bd.firebaseapp.com",
    projectId: "arboriza-bd",
    storageBucket: "arboriza-bd.firebasestorage.app",
    messagingSenderId: "210425976523",
    appId: "1:210425976523:web:2733f5b67fe02aa7d4ad4e"
};

const ADMIN_EMAILS = [
    "arborizarj@gmail.com",
    "stemacena@gmail.com",
    "stephannie.macena@edu.unirio.br",
    "tiagomartins.one@gmail.com"
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- 2. ESTADO DO DASHBOARD ---
const dashState = {
    map: null,
    treeLayer: null,
    partnerLayer: null,
    trees: [],
    approvedPartners: [],
    publicStats: null,
    adminData: null,
    mapFilter: "all"
};

// --- 3. UTILITÁRIOS ---
const escapeHtml = (unsafe = "") => {
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

const isAdminEmail = (email = "") => ADMIN_EMAILS.includes(String(email).toLowerCase());

let toastTimer = null;
const showToast = (msg) => {
    const el = document.getElementById("landing-toast");
    if (!el) return;
    el.querySelector("p").textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 4500);
};

const formatDateBR = (ts) => {
    if (!ts) return "-";
    try {
        const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
        return d.toLocaleDateString("pt-BR");
    } catch {
        return "-";
    }
};

const csvCell = (val = "") => {
    const s = String(val ?? "").replace(/"/g, '""');
    return `"${s}"`;
};

const downloadCsvFile = (filename, headers, rows) => {
    const lines = [
        headers.map(csvCell).join(";"),
        ...rows.map(r => r.map(csvCell).join(";"))
    ];
    // BOM UTF-8 para abrir com acentos perfeitos no Excel
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// --- 4. MAPA INTERATIVO AO VIVO DA LANDING PAGE ---
const initLiveMap = () => {
    const mapEl = document.getElementById("landing-live-map");
    if (!mapEl || dashState.map) return;

    dashState.map = L.map("landing-live-map", { scrollWheelZoom: false }).setView([-22.9068, -43.245], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap"
    }).addTo(dashState.map);

    dashState.treeLayer = L.layerGroup().addTo(dashState.map);
    dashState.partnerLayer = L.layerGroup().addTo(dashState.map);
};

const refreshMapMarkers = () => {
    if (!dashState.map) return;
    dashState.treeLayer.clearLayers();
    dashState.partnerLayer.clearLayers();

    const makeIcon = (color) => L.icon({
        iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${color}.png`,
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png",
        iconSize: [22, 36], iconAnchor: [11, 36], popupAnchor: [1, -30], shadowSize: [36, 36]
    });

    const icons = {
        healthy: makeIcon("green"),
        "needs-care": makeIcon("yellow"),
        critical: makeIcon("red"),
        default: makeIcon("blue"),
        partner: makeIcon("violet")
    };

    const bounds = [];

    if (dashState.mapFilter === "all" || dashState.mapFilter === "trees") {
        dashState.trees.forEach(t => {
            if (!t.location) return;
            const lat = parseFloat(t.location.latitude ?? t.location.lat ?? t.location._lat);
            const lng = parseFloat(t.location.longitude ?? t.location.lng ?? t.location._long);
            if (isNaN(lat) || isNaN(lng)) return;

            const statusLabel = t.status === "healthy" ? "Saudável" : t.status === "needs-care" ? "Precisa de cuidado" : "Crítica";
            L.marker([lat, lng], { icon: icons[t.status] || icons.default })
                .bindPopup(`<b>🌳 ${escapeHtml(t.commonName || "Árvore")}</b><br><i>${escapeHtml(t.scientificName || "")}</i><br>Estado: ${statusLabel}`)
                .addTo(dashState.treeLayer);
            bounds.push([lat, lng]);
        });
    }

    if (dashState.mapFilter === "all" || dashState.mapFilter === "partners") {
        dashState.approvedPartners.forEach(p => {
            if (!p.location) return;
            const lat = parseFloat(p.location.latitude ?? p.location.lat);
            const lng = parseFloat(p.location.longitude ?? p.location.lng);
            if (isNaN(lat) || isNaN(lng)) return;

            L.marker([lat, lng], { icon: icons.partner })
                .bindPopup(`<b>🏪 ${escapeHtml(p.businessName)}</b><br>${escapeHtml(p.address || "")}<br>🌳 ${p.treesImpacted || 0} árvores apoiadas`)
                .addTo(dashState.partnerLayer);
            bounds.push([lat, lng]);
        });
    }

    if (bounds.length > 0 && !dashState.hasFitBounds) {
        dashState.map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
        dashState.hasFitBounds = true;
    }
};

// --- 5. LISTENERS EM TEMPO REAL (VISÃO PÚBLICA) ---
const startPublicDashboardListeners = () => {
    const statusBadge = document.getElementById("dash-last-updated");

    // 1. Árvores em tempo real
    onSnapshot(collection(db, "trees"), (snap) => {
        dashState.trees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderTreesAnalytics();
        refreshMapMarkers();
        if (statusBadge) statusBadge.textContent = "🟢 Ao vivo";
    }, (err) => {
        console.warn("Leitura pública de árvores aguardando regra:", err);
        if (statusBadge) statusBadge.textContent = "⚠️ Ajuste regras do Firebase";
    });

    // 2. Parceiros aprovados em tempo real
    const partnersQ = query(collection(db, "partners"), where("status", "==", "approved"));
    onSnapshot(partnersQ, (snap) => {
        dashState.approvedPartners = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderPartnersAnalytics();
        refreshMapMarkers();
    }, (err) => {
        console.warn("Leitura pública de parceiros aguardando regra:", err);
    });

    // 3. Contadores agregados públicos (sem dados pessoais)
    onSnapshot(doc(db, "publicStats", "overview"), (docSnap) => {
        if (docSnap.exists()) {
            dashState.publicStats = docSnap.data();
            renderAggregatedStats();
        } else {
            // Valores iniciais de referência até a primeira sincronização na Guia Admin
            document.getElementById("metric-users").textContent = "18+";
            document.getElementById("metric-missions").textContent = "0";
            document.getElementById("metric-emblems").textContent = "0";
            document.getElementById("metric-messages").textContent = "35+";
        }
    }, (err) => {
        console.warn("publicStats/overview ainda não configurado:", err);
    });
};

const renderTreesAnalytics = () => {
    const trees = dashState.trees;
    const total = trees.length;
    document.getElementById("metric-trees").textContent = total;

    let healthy = 0;
    let care = 0;
    let critical = 0;
    const speciesCount = {};

    trees.forEach(t => {
        if (t.status === "healthy") healthy++;
        else if (t.status === "needs-care") care++;
        else if (t.status === "critical") critical++;
        else healthy++;

        const sp = (t.commonName || "Não identificada").trim();
        speciesCount[sp] = (speciesCount[sp] || 0) + 1;
    });

    const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);

    document.getElementById("health-healthy-count").textContent = healthy;
    document.getElementById("health-healthy-pct").textContent = `${pct(healthy)}%`;
    document.getElementById("health-healthy-bar").style.width = `${pct(healthy)}%`;

    document.getElementById("health-care-count").textContent = care;
    document.getElementById("health-care-pct").textContent = `${pct(care)}%`;
    document.getElementById("health-care-bar").style.width = `${pct(care)}%`;

    document.getElementById("health-critical-count").textContent = critical;
    document.getElementById("health-critical-pct").textContent = `${pct(critical)}%`;
    document.getElementById("health-critical-bar").style.width = `${pct(critical)}%`;

    const topSpecies = Object.entries(speciesCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const listEl = document.getElementById("top-species-list");
    if (topSpecies.length === 0) {
        listEl.innerHTML = `<p class="text-slate-500 italic">Nenhuma espécie registrada ainda.</p>`;
        return;
    }

    listEl.innerHTML = topSpecies.map(([name, count], idx) => `
        <div class="flex items-center justify-between gap-2 bg-sky-50/70 px-3 py-1.5 rounded-lg border border-sky-100">
            <span class="font-bold text-slate-800 truncate">${idx + 1}. 🌿 ${escapeHtml(name)}</span>
            <span class="font-extrabold text-verde-principal whitespace-nowrap">${count} un.</span>
        </div>
    `).join("");
};

const renderPartnersAnalytics = () => {
    const partners = dashState.approvedPartners;
    const totalPartners = partners.length;
    const totalVouchers = partners.reduce((acc, p) => acc + (Number(p.vouchersRedeemed) || 0), 0);
    const totalTreesImpacted = partners.reduce((acc, p) => acc + (Number(p.treesImpacted) || 0), 0);

    document.getElementById("metric-partners").textContent = totalPartners;
    document.getElementById("metric-vouchers").textContent = Math.max(totalVouchers, Number(dashState.publicStats?.vouchersRedeemed) || 0);
    document.getElementById("metric-trees-impacted").textContent = totalTreesImpacted;
};

const renderAggregatedStats = () => {
    const s = dashState.publicStats;
    if (!s) return;
    document.getElementById("metric-users").textContent = s.activeUsers ?? 0;
    document.getElementById("metric-missions").textContent = s.missionsCompleted ?? 0;
    document.getElementById("metric-emblems").textContent = s.emblemsUnlocked ?? 0;
    document.getElementById("metric-messages").textContent = s.totalMessages ?? 0;
    if (typeof s.vouchersRedeemed === "number") {
        const currentDisplayed = parseInt(document.getElementById("metric-vouchers").textContent, 10) || 0;
        document.getElementById("metric-vouchers").textContent = Math.max(currentDisplayed, s.vouchersRedeemed);
    }
};

// --- 6. GUIA ADMINISTRATIVA (AUTENTICAÇÃO + RELATÓRIOS GRANULARES + CSV) ---
const loadAdminGranularData = async (autoPublishPublicStats = true) => {
    const metricsEl = document.getElementById("admin-granular-metrics");
    if (metricsEl) metricsEl.innerHTML = `<p class="col-span-full text-center text-sm text-slate-500 py-4">Carregando auditoria completa do banco...</p>`;

    try {
        const [usersSnap, treesSnap, partnersSnap, rewardsSnap, redemptionsSnap, careEventsSnap] = await Promise.all([
            getDocs(collection(db, "users")),
            getDocs(collection(db, "trees")),
            getDocs(collection(db, "partners")),
            getDocs(collection(db, "partnerRewards")),
            getDocs(collection(db, "redemptions")),
            getDocs(collectionGroup(db, "careEvents"))
        ]);

        const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const trees = treesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const partners = partnersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const rewards = rewardsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const redemptions = redemptionsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const careEvents = careEventsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const totalCares = users.reduce((s, u) => s + (Number(u.treesCared) || 0), 0);
        const totalIdentified = users.reduce((s, u) => s + (Number(u.treesIdentified) || 0), 0);
        const missionsCompleted = users.reduce((s, u) => s + ((u.claimedMissions || []).length), 0);
        const emblemsUnlocked = users.reduce((s, u) => s + ((u.unlockedEmblems || []).length), 0);
        const totalMessages = careEvents.filter(e => (e.message && e.message.trim().length > 0)).length;
        const activePartners = partners.filter(p => p.status === "approved").length;
        const pendingPartners = partners.filter(p => p.status === "pending").length;
        const usedVouchers = redemptions.filter(r => r.status === "used").length;
        const distinctSpecies = new Set(trees.map(t => (t.scientificName || t.commonName || "").toLowerCase()).filter(Boolean)).size;

        dashState.adminData = {
            users, trees, partners, rewards, redemptions, careEvents,
            summary: {
                activeUsers: users.length,
                totalTrees: trees.length,
                distinctSpecies,
                totalCares,
                totalIdentified,
                missionsCompleted,
                emblemsUnlocked,
                totalMessages,
                activePartners,
                pendingPartners,
                vouchersRedeemed: redemptions.length,
                usedVouchers
            }
        };

        // Renderiza os 8 cards granulares
        const cards = [
            { label: "Usuários Cadastrados", value: users.length, emoji: "👤" },
            { label: "Espécies Distintas", value: distinctSpecies, emoji: "🌿" },
            { label: "Cuidados Registrados", value: totalCares, emoji: "💧" },
            { label: "Árvores Identificadas", value: totalIdentified, emoji: "📲" },
            { label: "Missões Concluídas", value: missionsCompleted, emoji: "🎯" },
            { label: "Selos Desbloqueados", value: emblemsUnlocked, emoji: "🏅" },
            { label: "Parceiros Pendentes", value: pendingPartners, emoji: "🕓" },
            { label: "Vouchers Usados / Total", value: `${usedVouchers}/${redemptions.length}`, emoji: "🎟️" }
        ];

        metricsEl.innerHTML = cards.map(c => `
            <div class="aero-kpi-card">
                <span class="text-xl">${c.emoji}</span>
                <strong class="kpi-value text-xl">${escapeHtml(c.value)}</strong>
                <span class="kpi-label">${escapeHtml(c.label)}</span>
            </div>
        `).join("");

        // Distribuição por nível
        const levelsMap = {};
        users.forEach(u => {
            const name = u.levelName || "Nível 1: Semente";
            levelsMap[name] = (levelsMap[name] || 0) + 1;
        });
        document.getElementById("admin-levels-breakdown").innerHTML = Object.entries(levelsMap)
            .sort((a, b) => b[1] - a[1])
            .map(([lvl, qty]) => {
                const p = users.length > 0 ? Math.round((qty / users.length) * 100) : 0;
                return `
                    <div>
                        <div class="flex justify-between font-bold text-slate-700 mb-1">
                            <span>${escapeHtml(lvl)}</span>
                            <span>${qty} (${p}%)</span>
                        </div>
                        <div class="aero-progress-track">
                            <div class="aero-progress-fill" style="width: ${p}%"></div>
                        </div>
                    </div>
                `;
            }).join("");

        // Tabela de parceiros
        const pBody = document.getElementById("admin-partners-table");
        pBody.innerHTML = partners.length === 0
            ? `<tr><td colspan="4" class="py-3 text-center text-slate-500 italic">Nenhum parceiro cadastrado ainda.</td></tr>`
            : partners.map(p => `
                <tr>
                    <td class="py-2 pr-2 font-bold text-slate-800">${escapeHtml(p.businessName)}</td>
                    <td class="py-2 pr-2">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${p.status === "approved" ? "bg-emerald-100 text-emerald-800" : p.status === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}">
                            ${p.status === "approved" ? "Ativo" : p.status === "rejected" ? "Recusado" : "Pendente"}
                        </span>
                    </td>
                    <td class="py-2 pr-2 text-right font-bold text-verde-principal">${p.treesImpacted || 0}</td>
                    <td class="py-2 text-right font-bold text-sky-800">${p.vouchersRedeemed || 0}</td>
                </tr>
            `).join("");

        // Últimas árvores
        const recentTrees = [...trees]
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
            .slice(0, 12);

        document.getElementById("admin-recent-trees-table").innerHTML = recentTrees.map(t => `
            <tr>
                <td class="py-2 pr-3 font-bold text-slate-800">${escapeHtml(t.commonName || "-")}</td>
                <td class="py-2 pr-3 italic text-slate-600">${escapeHtml(t.scientificName || "-")}</td>
                <td class="py-2 pr-3 font-semibold">${t.status === "healthy" ? "🟢 Saudável" : t.status === "needs-care" ? "🟡 Cuidado" : "🔴 Crítica"}</td>
                <td class="py-2 pr-3 text-slate-700">${escapeHtml(t.createdBy?.name || "Comunidade")}</td>
                <td class="py-2 text-slate-500">${formatDateBR(t.createdAt)}</td>
            </tr>
        `).join("");

        if (autoPublishPublicStats) {
            await publishPublicStatsSnapshot(false);
        }
    } catch (err) {
        console.error("Erro na Guia Administrativa:", err);
        showToast("Erro ao carregar dados administrativos. Verifique se as Regras do Firebase foram atualizadas.");
    }
};

const publishPublicStatsSnapshot = async (notify = true) => {
    if (!dashState.adminData?.summary) return;
    const s = dashState.adminData.summary;
    try {
        await setDoc(doc(db, "publicStats", "overview"), {
            activeUsers: s.activeUsers,
            totalTrees: s.totalTrees,
            missionsCompleted: s.missionsCompleted,
            emblemsUnlocked: s.emblemsUnlocked,
            activePartners: s.activePartners,
            vouchersRedeemed: s.vouchersRedeemed,
            totalMessages: s.totalMessages,
            updatedAt: serverTimestamp()
        }, { merge: true });
        if (notify) showToast("✅ Placar público do site sincronizado com sucesso!");
    } catch (err) {
        console.error("Erro ao sincronizar publicStats:", err);
        if (notify) showToast("Não foi possível atualizar o placar público. Confirme a regra de publicStats no Firebase.");
    }
};

// --- 7. INICIALIZAÇÃO E EVENTOS ---
document.addEventListener("DOMContentLoaded", () => {
    // 1. Mantém a configuração original dos botões para a plataforma
    document.querySelectorAll(".app-link-btn").forEach(btn => {
        btn.href = LINK_DA_PLATAFORMA;
        btn.target = "_blank";
        btn.rel = "noopener noreferrer";
    });

    // 2. Ícones Lucide
    if (window.lucide) lucide.createIcons();

    // 3. Menu Mobile
    const mobileBtn = document.getElementById("mobile-menu-btn");
    const mobileMenu = document.getElementById("mobile-menu");
    mobileBtn?.addEventListener("click", () => mobileMenu?.classList.toggle("hidden"));
    document.querySelectorAll(".mobile-nav-item").forEach(item => {
        item.addEventListener("click", () => mobileMenu?.classList.add("hidden"));
    });

    // 4. Animação suave ao rolar (Fade In preservado)
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) entry.target.classList.add("is-visible");
        });
    }, { threshold: 0.1 });

    document.querySelectorAll(".fade-in-section").forEach(sec => observer.observe(sec));

    // 5. Inicializa Mapa Vivo + Listeners Públicos
    initLiveMap();
    startPublicDashboardListeners();

    // 6. Filtros do Mapa Vivo
    const setMapFilter = (mode) => {
        dashState.mapFilter = mode;
        ["all", "trees", "partners"].forEach(m => {
            document.getElementById(`map-filter-${m}`)?.classList.toggle("active", m === mode);
        });
        refreshMapMarkers();
    };
    document.getElementById("map-filter-all")?.addEventListener("click", () => setMapFilter("all"));
    document.getElementById("map-filter-trees")?.addEventListener("click", () => setMapFilter("trees"));
    document.getElementById("map-filter-partners")?.addEventListener("click", () => setMapFilter("partners"));

    // 7. Alternância entre Visão Pública e Guia Administrativa
    const switchDashTab = (tab) => {
        const isPublic = tab === "public";
        document.getElementById("dash-tab-public").classList.toggle("aero-tab-active", isPublic);
        document.getElementById("dash-tab-admin").classList.toggle("aero-tab-active", !isPublic);
        document.getElementById("dash-tab-public").setAttribute("aria-selected", String(isPublic));
        document.getElementById("dash-tab-admin").setAttribute("aria-selected", String(!isPublic));
        document.getElementById("dash-panel-public").classList.toggle("hidden", !isPublic);
        document.getElementById("dash-panel-admin").classList.toggle("hidden", isPublic);
        if (isPublic && dashState.map) {
            setTimeout(() => dashState.map.invalidateSize(), 80);
        }
    };
    document.getElementById("dash-tab-public")?.addEventListener("click", () => switchDashTab("public"));
    document.getElementById("dash-tab-admin")?.addEventListener("click", () => switchDashTab("admin"));

    // 8. Autenticação da Guia Administrativa
    onAuthStateChanged(auth, (user) => {
        const loginBox = document.getElementById("admin-login-box");
        const contentBox = document.getElementById("admin-content-box");
        const errEl = document.getElementById("admin-login-error");

        if (user && isAdminEmail(user.email)) {
            loginBox.classList.add("hidden");
            contentBox.classList.remove("hidden");
            document.getElementById("admin-user-email").textContent = user.email;
            loadAdminGranularData(true);
        } else {
            if (user && !isAdminEmail(user.email)) {
                errEl.textContent = "Esta conta não possui permissão de administrador.";
                errEl.classList.remove("hidden");
                signOut(auth);
            }
            loginBox.classList.remove("hidden");
            contentBox.classList.add("hidden");
        }
    });

    document.getElementById("btn-admin-google-login")?.addEventListener("click", async () => {
        const errEl = document.getElementById("admin-login-error");
        errEl.classList.add("hidden");
        try {
            await signInWithPopup(auth, new GoogleAuthProvider());
        } catch (err) {
            errEl.textContent = err.code === "auth/unauthorized-domain"
                ? "Adicione conhecaarboriza.netlify.app nos Domínios Autorizados do Firebase Auth."
                : "Erro ao entrar com Google. Tente novamente.";
            errEl.classList.remove("hidden");
        }
    });

    document.getElementById("admin-email-login-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("admin-login-email").value.trim();
        const pass = document.getElementById("admin-login-password").value;
        const errEl = document.getElementById("admin-login-error");
        errEl.classList.add("hidden");
        try {
            await signInWithEmailAndPassword(auth, email, pass);
        } catch {
            errEl.textContent = "Email ou senha incorretos.";
            errEl.classList.remove("hidden");
        }
    });

    document.getElementById("btn-admin-logout")?.addEventListener("click", () => signOut(auth));
    document.getElementById("btn-sync-public-stats")?.addEventListener("click", () => publishPublicStatsSnapshot(true));

    // 9. Exportação de Relatórios CSV (Guia Admin)
    document.getElementById("btn-export-summary-csv")?.addEventListener("click", () => {
        const s = dashState.adminData?.summary;
        if (!s) return;
        const today = new Date().toISOString().slice(0, 10);
        downloadCsvFile(
            `arboriza_relatorio_geral_${today}.csv`,
            ["Indicador", "Valor"],
            [
                ["Data da extração", today],
                ["Usuários ativos", s.activeUsers],
                ["Total de árvores cadastradas", s.totalTrees],
                ["Espécies distintas", s.distinctSpecies],
                ["Ações de cuidado registradas", s.totalCares],
                ["Identificações realizadas", s.totalIdentified],
                ["Missões concluídas", s.missionsCompleted],
                ["Selos/Emblemas desbloqueados", s.emblemsUnlocked],
                ["Mensagens nos murais", s.totalMessages],
                ["Parceiros ativos", s.activePartners],
                ["Parceiros pendentes", s.pendingPartners],
                ["Vouchers resgatados", s.vouchersRedeemed],
                ["Vouchers utilizados", s.usedVouchers]
            ]
        );
        showToast("📥 Relatório geral exportado em CSV!");
    });

    document.getElementById("btn-export-trees-csv")?.addEventListener("click", () => {
        const trees = dashState.adminData?.trees || [];
        if (trees.length === 0) return;
        const today = new Date().toISOString().slice(0, 10);
        downloadCsvFile(
            `arboriza_arvores_${today}.csv`,
            ["ID", "Nome Popular", "Nome Científico", "Família", "É Árvore", "Saúde", "Latitude", "Longitude", "Guardião", "Data"],
            trees.map(t => [
                t.id,
                t.commonName || "",
                t.scientificName || "",
                t.family || "",
                t.isTree === false ? "Não" : "Sim",
                t.status || "",
                t.location?.latitude ?? t.location?.lat ?? "",
                t.location?.longitude ?? t.location?.lng ?? "",
                t.createdBy?.name || "",
                formatDateBR(t.createdAt)
            ])
        );
        showToast("🌳 Base completa de árvores exportada em CSV!");
    });
});