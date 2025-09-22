// ================== SCRIPT PRINCIPAL ==================

// Renderização principal (desktop + mobile + tabela + impressão)
async function renderAll() {
  const appointments = await window.apiClient.getAppointments();
  renderSchedule(appointments);
  renderUnscheduled(appointments);
  renderServicesTable(appointments);
  renderMobileDay(appointments, currentDate);
  if (typeof window.fillPrintFromAppointments === "function") {
    window.fillPrintFromAppointments(appointments);
  }
}

// ----------------- MOBILE VIEW -----------------

function renderMobileDay(appointments, date) {
  const list = document.getElementById("mobileDayList");
  if (!list) return;

  const dayStr = date.toISOString().split("T")[0];
  const dayAppointments = appointments.filter(a => a.date === dayStr);

  if (dayAppointments.length === 0) {
    list.innerHTML = `<p style="padding:12px;">Nenhum serviço neste dia.</p>`;
    return;
  }

  list.innerHTML = dayAppointments.map(a => buildMobileCard(a)).join("");
}

// --- CARTÃO MOBILE ---
function buildMobileCard(a) {
  const title = `${a.plate || "—"} • ${a.car || "—"}`;
  const chips = `
    <span class="m-chip">${a.period || ""}</span>
    <span class="m-chip">${a.service || ""}</span>
    <span class="m-chip">${a.locality || ""}</span>
  `;
  const notes = a.notes ? `<div class="m-info">${a.notes}</div>` : "";

  // Botão Google Maps (ícone oficial)
  const mapsBtn = a.address ? `
    <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      a.address
    )}"
       target="_blank" rel="noopener noreferrer" class="icon-btn" title="Abrir no Google Maps">
      <img src="https://cdn.simpleicons.org/googlemaps/ffffff" alt="Google Maps" width="18" height="18"
           onerror="this.src=''; this.parentElement.textContent='🌍';"/>
    </a>` : "";

  // Botão Waze (ícone oficial)
  const wazeBtn = a.address ? `
    <a href="https://waze.com/ul?q=${encodeURIComponent(a.address)}"
       target="_blank" rel="noopener noreferrer" class="icon-btn" title="Abrir no Waze">
      <img src="https://cdn.simpleicons.org/waze/ffffff" alt="Waze" width="18" height="18"
           onerror="this.src=''; this.parentElement.textContent='🗺️';"/>
    </a>` : "";

  // Cores do gradiente pela localidade
  const g = getLocalityColors(a.locality);

  return `
    <div class="appointment m-card" data-id="${a.id}"
         style="--c1:${g.c1}; --c2:${g.c2}; position:relative;">
      <div class="map-icons">
        ${wazeBtn}${mapsBtn}
      </div>
      <div class="m-title">${title}</div>
      <div class="m-chips">${chips}</div>
      ${notes}
    </div>
  `;
}

// ----------------- LOCALIDADES -----------------

function getLocalityColors(locality) {
  const map = window.LOCALITY_COLORS || {};
  const color = map[locality] || "#9CA3AF";
  return { c1: color, c2: color };
}

// ----------------- PLACEHOLDERS -----------------

function renderSchedule() {
  /* já existente no teu projeto */
}

function renderUnscheduled() {
  /* já existente no teu projeto */
}

function renderServicesTable() {
  /* já existente no teu projeto */
}

// ----------------- EVENTOS -----------------

document.addEventListener("DOMContentLoaded", () => {
  renderAll();

  // Navegação mobile
  document.getElementById("todayDay")?.addEventListener("click", () => {
    currentDate = new Date();
    renderAll();
  });
  document.getElementById("prevDay")?.addEventListener("click", () => {
    currentDate.setDate(currentDate.getDate() - 1);
    renderAll();
  });
  document.getElementById("nextDay")?.addEventListener("click", () => {
    currentDate.setDate(currentDate.getDate() + 1);
    renderAll();
  });
});

// Variável global para data corrente (mobile)
let currentDate = new Date();