// Auto-parse access token from URL and add to request headers
(function() {
  console.log('Auto-token-handler.js loaded');
  // Parse URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const accessToken = urlParams.get('accessToken');
  
  if (accessToken) {
    // Store token in localStorage for persistence
    localStorage.setItem('accessToken', accessToken);
    
    // Clean URL by removing the token parameter
    urlParams.delete('accessToken');
    const newSearch = urlParams.toString();
    const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
    
    // Update URL without reloading the page
    window.history.replaceState({}, document.title, newUrl);
    
    console.log('Access token parsed and stored from URL');
  }
  
  // Intercept all fetch requests to add Authorization header
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    let [resource, config] = args;
    
    // Get token from localStorage
    const token = localStorage.getItem('accessToken');
    
    if (token) {
      // Ensure config object exists
      config = config || {};
      config.headers = config.headers || {};
      
      // Add Authorization header if not already present
      if (!config.headers['Authorization']) {
        config.headers['Authorization'] = `Bearer ${token}`;
        console.log('Added token to fetch request:', resource);
      }
      
      // Update args with modified config
      args[1] = config;
    } else {
      console.warn('No access token found for fetch request:', resource);
    }
    
    return originalFetch.apply(this, args);
  };
  
  // Intercept XMLHttpRequest to add Authorization header
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._url = url;
    this._method = method;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };
  
  XMLHttpRequest.prototype.send = function(...args) {
    const token = localStorage.getItem('accessToken');
    
    if (token) {
      try {
        // Some browsers don't have getRequestHeader or it may throw
        const hasAuth = this.getAllResponseHeaders && this.getRequestHeader && this.getRequestHeader('Authorization');
        if (!hasAuth) {
          this.setRequestHeader('Authorization', `Bearer ${token}`);
        }
      } catch (e) {
        // If checking fails, just set the header
        this.setRequestHeader('Authorization', `Bearer ${token}`);
      }
    }
    
    return originalXHRSend.apply(this, args);
  };
  
  // For axios specifically (if used)
  if (window.axios) {
    window.axios.interceptors.request.use(
      config => {
        const token = localStorage.getItem('accessToken');
        if (token && !config.headers['Authorization']) {
          config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
      },
      error => Promise.reject(error)
    );
  }
  
  // Helper function to clear token
  window.clearAccessToken = function() {
    localStorage.removeItem('accessToken');
    console.log('Access token cleared');
  };
  
  // Helper function to get current token
  window.getAccessToken = function() {
    return localStorage.getItem('accessToken');
  };
})();