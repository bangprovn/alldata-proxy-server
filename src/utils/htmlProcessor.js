export function replaceExternalLinks(html) {
  // Replace all external asset links with local server paths
  let processedHtml = html;

  // Common external domains to replace
  const externalDomains = [
    'https://data-eu.partnership.workshopdiag.com',
    'http://data-eu.partnership.workshopdiag.com',
    '//data-eu.partnership.workshopdiag.com'
  ];

  // Replace each external domain with empty string (relative path)
  externalDomains.forEach(domain => {
    processedHtml = processedHtml.replace(new RegExp(domain, 'g'), '');
  });

  // Replace specific patterns like /app-alldata/akam/13/[hash] with local paths
  // These are typically JavaScript or CSS files with hash-based names
  processedHtml = processedHtml.replace(
    /\/app-alldata\/akam\/\d+\/[a-f0-9]+/g,
    (match) => {
      // Extract the hash part and determine file type
      const parts = match.split('/');
      const hash = parts[parts.length - 1];

      // Check if it's referenced in a script or link tag to determine extension
      // This is a simplified approach - you may need to enhance based on actual usage
      return `/assets/${hash}.js`;
    }
  );

  // Replace any remaining absolute URLs pointing to external resources
  processedHtml = processedHtml.replace(
    /(href|src)=["']https?:\/\/[^"']*\/(app-alldata|assets|static)\/([^"']+)["']/gi,
    (match, attr, folder, path) => {
      return `${attr}="/${folder}/${path}"`;
    }
  );

  // Handle protocol-relative URLs
  processedHtml = processedHtml.replace(
    /(href|src)=["']\/\/[^"']*\/(app-alldata|assets|static)\/([^"']+)["']/gi,
    (match, attr, folder, path) => {
      return `${attr}="/${folder}/${path}"`;
    }
  );

  return processedHtml;
}