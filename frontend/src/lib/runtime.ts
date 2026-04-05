export function getBasePath(pathname = window.location.pathname): string {
  const match = pathname.match(/^(.*\/)(?:room\/[A-Za-z0-9]{4})$/);
  if (match) {
    return match[1];
  }

  if (pathname.startsWith('/taccan')) {
    return '/taccan/';
  }

  return '/';
}

export function getBasePathNoTrailingSlash(pathname = window.location.pathname): string {
  const basePath = getBasePath(pathname);
  return basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
}

export function getInitialRoomCode(pathname = window.location.pathname): string {
  const match = pathname.match(/\/room\/([A-Za-z0-9]{4})$/);
  return match ? match[1].toUpperCase() : '';
}

export function getRoomUrl(code: string): string {
  const basePath = getBasePathNoTrailingSlash();
  return `${window.location.origin}${basePath}/room/${code}`;
}

export function getServiceWorkerPath(): { path: string; scope: string } {
  const basePath = getBasePath();
  return {
    path: `${basePath}sw.js`,
    scope: basePath,
  };
}

export function getAssetPath(name: string): string {
  return `${getBasePath()}${name}`;
}
