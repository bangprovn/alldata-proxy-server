import axios from 'axios';

const API_BASE = 'http://localhost:3000';

async function testCachePerformance() {
  console.log('Testing Cache Performance...\n');

  try {
    // Test 1: Cache Stats
    console.log('1. Getting cache statistics:');
    const statsResponse = await axios.get(`${API_BASE}/api/cache/stats`);
    console.log('Cache Stats:', JSON.stringify(statsResponse.data, null, 2));
    console.log('\n');

    // Test 2: Make some API requests to populate cache
    console.log('2. Making API requests to populate cache:');
    const testUrls = [
      '/alldata/vehicle/home',
      '/api/health',
    ];

    for (const url of testUrls) {
      const start = Date.now();
      const response = await axios.get(`${API_BASE}${url}`, {
        validateStatus: () => true
      });
      const duration = Date.now() - start;
      console.log(`${url} - Status: ${response.status}, Time: ${duration}ms, Cache: ${response.headers['x-cache'] || 'N/A'}`);
    }
    console.log('\n');

    // Test 3: Make the same requests again to test cache hits
    console.log('3. Making same requests again (should be cached):');
    for (const url of testUrls) {
      const start = Date.now();
      const response = await axios.get(`${API_BASE}${url}`, {
        validateStatus: () => true
      });
      const duration = Date.now() - start;
      console.log(`${url} - Status: ${response.status}, Time: ${duration}ms, Cache: ${response.headers['x-cache'] || 'N/A'}`);
    }
    console.log('\n');

    // Test 4: Get updated cache stats
    console.log('4. Updated cache statistics:');
    const updatedStats = await axios.get(`${API_BASE}/api/cache/stats`);
    console.log('Summary:', updatedStats.data.summary);
    console.log('Top Accessed:', updatedStats.data.topAccessed?.slice(0, 3));
    console.log('\n');

    // Test 5: Test cache cleanup
    console.log('5. Testing cache cleanup (remove entries accessed less than 2 times):');
    const cleanupResponse = await axios.post(`${API_BASE}/api/cache/cleanup`, {
      minAccessCount: 2
    });
    console.log('Cleanup result:', cleanupResponse.data);
    console.log('\n');

    // Test 6: Test cache revalidation
    console.log('6. Testing cache revalidation for /api path:');
    const revalidateResponse = await axios.post(`${API_BASE}/api/cache/revalidate`, {
      path: '/api'
    });
    console.log('Revalidation result:', revalidateResponse.data);

  } catch (error) {
    console.error('Error during testing:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testCachePerformance();