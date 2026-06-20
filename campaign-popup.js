(function () {
  'use strict';

  var _campaign = null;

  function _todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function _wasShown(slotKey) {
    try {
      var stored = JSON.parse(localStorage.getItem('campaign_shown') || '{}');
      return (stored[_todayKey()] || {})[slotKey] === true;
    } catch (e) { return false; }
  }

  function _markShown(slotKey) {
    try {
      var stored = JSON.parse(localStorage.getItem('campaign_shown') || '{}');
      var today = _todayKey();
      stored[today] = stored[today] || {};
      stored[today][slotKey] = true;
      Object.keys(stored).forEach(function (d) { if (d < today) delete stored[d]; });
      localStorage.setItem('campaign_shown', JSON.stringify(stored));
    } catch (e) {}
  }

  // ── Modal horária (só imagem + fechar) ───────────────────────────────────
  function _showModal() {
    if (!_campaign || !_campaign.image_data) return;
    var modal = document.getElementById('campaignPopupModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'campaignPopupModal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.78);padding:16px;box-sizing:border-box;';
      document.body.appendChild(modal);
      modal.addEventListener('click', function (e) { if (e.target === modal) modal.style.display = 'none'; });
    }
    modal.innerHTML =
      '<div style="position:relative;max-width:640px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.7);">' +
        '<button id="campPopClose" style="position:absolute;top:10px;right:10px;z-index:10;background:rgba(0,0,0,0.55);color:#fff;border:none;width:34px;height:34px;border-radius:50%;font-size:19px;line-height:34px;text-align:center;cursor:pointer;font-weight:700;">✕</button>' +
        '<img src="' + _campaign.image_data + '" alt="Campanha" style="width:100%;display:block;max-height:88vh;object-fit:contain;background:#000;">' +
      '</div>';
    modal.querySelector('#campPopClose').addEventListener('click', function () { modal.style.display = 'none'; });
    modal.style.display = 'flex';
  }

  // ── Modal interativa (imagem + Sim / Não) ────────────────────────────────
  function _showInteractiveModal(onSim, onNao) {
    if (!_campaign || !_campaign.image_data) {
      // Sem campanha ativa — executar diretamente com emojis normais
      if (onSim) onSim();
      return;
    }
    var modal = document.getElementById('campaignPopupModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'campaignPopupModal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.78);padding:16px;box-sizing:border-box;';
      document.body.appendChild(modal);
    }
    modal.innerHTML =
      '<div style="position:relative;max-width:540px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.7);background:#fff;">' +
        '<img src="' + _campaign.image_data + '" alt="Campanha" style="width:100%;display:block;max-height:60vh;object-fit:contain;background:#000;">' +
        '<div style="padding:18px 20px;display:flex;gap:12px;">' +
          '<button id="campPopSim" style="flex:1;background:#16a34a;color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:800;cursor:pointer;">👍 Sim</button>' +
          '<button id="campPopNao" style="flex:1;background:#dc2626;color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:800;cursor:pointer;">👎 Não</button>' +
        '</div>' +
      '</div>';
    modal.querySelector('#campPopSim').addEventListener('click', function () {
      modal.style.display = 'none';
      if (onSim) onSim();
    });
    modal.querySelector('#campPopNao').addEventListener('click', function () {
      modal.style.display = 'none';
      if (onNao) onNao();
    });
    modal.style.display = 'flex';
  }

  // ── Slots horários ───────────────────────────────────────────────────────
  function _scheduleSlot(slot) {
    var now = new Date();
    var fire = new Date(now.getFullYear(), now.getMonth(), now.getDate(), slot.h, slot.m, 0, 0);
    var ms = fire - now;

    if (ms <= 0) {
      if (ms > -30 * 60 * 1000 && !_wasShown(slot.key)) {
        _markShown(slot.key);
        _showModal();
      }
      return;
    }

    setTimeout(function () {
      if (!_wasShown(slot.key)) {
        _markShown(slot.key);
        _showModal();
      }
    }, ms);
  }

  function _buildSlots() {
    var slots = null;
    if (_campaign && _campaign.display_hours) {
      var parsed = String(_campaign.display_hours).split(',').map(function (s) {
        s = s.trim();
        if (/^\d+$/.test(s)) {
          var h = parseInt(s, 10);
          return isNaN(h) ? null : { h: h, m: 0, key: 'h' + h + 'm0' };
        }
        var parts = s.split(':');
        if (parts.length === 2) {
          var hh = parseInt(parts[0], 10), mm = parseInt(parts[1], 10);
          if (!isNaN(hh) && !isNaN(mm)) return { h: hh, m: mm, key: 'h' + hh + 'm' + mm };
        }
        return null;
      }).filter(Boolean);
      if (parsed.length > 0) slots = parsed;
    }
    if (!slots) slots = [{ h: 9, m: 0, key: 'h9m0' }, { h: 14, m: 0, key: 'h14m0' }, { h: 17, m: 0, key: 'h17m0' }];
    return slots;
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function _init() {
    fetch('/.netlify/functions/campaign')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success || !d.campaign) return;
        _campaign = d.campaign;

        if (_campaign.campaign_type === 'interativa') {
          // Expor função para script.js usar quando clicam em "Serviço Realizado"
          window._showInteractiveCampaign = function (onSim, onNao) {
            _showInteractiveModal(onSim, onNao);
          };
        } else {
          // Horária: agendar slots normais
          _buildSlots().forEach(_scheduleSlot);
        }
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }
})();
