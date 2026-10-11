export const homeFor = (role) => ({ technician: '#/t', collector: '#/c', recycler: '#/r', brand: '#/b', admin: '#/admin', customer: '#/my' }[role] || '#/');
