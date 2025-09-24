// ✅ CORREÇÃO: Função para migração gradual da API Google Places
function initializeGooglePlaces() {
  const addressInput = document.getElementById('address');
  if (!addressInput) return;

  // Verificar se a nova API está disponível
  if (window.google?.maps?.places?.PlaceAutocompleteElement) {
    console.log('🆕 Usando nova API Google Places (PlaceAutocompleteElement)');
    initializeNewPlacesAPI(addressInput);
  } else if (window.google?.maps?.places?.Autocomplete) {
    console.log('⚠️ Usando API Google Places legacy (será descontinuada em março 2025)');
    initializeLegacyPlacesAPI(addressInput);
  } else {
    console.warn('❌ Google Places API não disponível');
  }
}

// Nova API (recomendada a partir de março 2025)
function initializeNewPlacesAPI(addressInput) {
  try {
    const autocomplete = new google.maps.places.PlaceAutocompleteElement();
    autocomplete.id = 'places-autocomplete';
    autocomplete.placeholder = 'Morada do cliente';
    
    // Configurações
    autocomplete.componentRestrictions = { country: 'pt' };
    autocomplete.types = ['geocode', 'establishment'];
    
    // Substituir o input original
    const container = addressInput.parentElement;
    container.insertBefore(autocomplete, addressInput);
    addressInput.style.display = 'none';
    
    // Event listener para sincronizar valores
    autocomplete.addEventListener('gmp-placeselect', (event) => {
      const place = event.place;
      if (place && place.formattedAddress) {
        addressInput.value = place.formattedAddress;
        console.log('📍 Endereço selecionado:', place.formattedAddress);
      }
    });
    
  } catch (error) {
    console.error('Erro ao inicializar nova API Places:', error);
    // Fallback para API legacy
    initializeLegacyPlacesAPI(addressInput);
  }
}

// API Legacy (funciona até março 2025)
function initializeLegacyPlacesAPI(addressInput) {
  try {
    const autocomplete = new google.maps.places.Autocomplete(addressInput, {
      types: ['geocode', 'establishment'],
      componentRestrictions: { country: 'pt' },
      fields: ['place_id', 'name', 'formatted_address', 'geometry']
    });

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place) return;

      addressInput.value = place.formatted_address || place.name || addressInput.value;
      console.log('📍 Endereço selecionado (legacy):', addressInput.value);
    });
    
  } catch (error) {
    console.error('Erro ao inicializar API Places legacy:', error);
  }
}

// Inicializar quando Google Maps estiver carregado
function waitForGoogleMaps() {
  if (window.google && window.google.maps && window.google.maps.places) {
    initializeGooglePlaces();
  } else {
    // Tentar novamente após 100ms
    setTimeout(waitForGoogleMaps, 100);
  }
}

// Inicializar quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  waitForGoogleMaps();
});

// ✅ RESTO DO CÓDIGO ORIGINAL (preservado)
// [Aqui seria incluído todo o resto do código do script.js original]

// Exemplo de como integrar com o código existente:
/*
// Substituir a secção original do Google Places (linhas ~710-725) por:
document.addEventListener('DOMContentLoaded', () => {
  // ... resto da inicialização ...
  
  // Inicializar Google Places com nova API
  waitForGoogleMaps();
});
*/