# Firestore Security Specification

## 1. Data Invariants
1. **Strict Ownership**: A user (`request.auth.uid`) can only read or write documents under `/users/{userId}` when `userId == request.auth.uid` and `request.auth.token.email_verified == true`.
2. **Parent Existence (Master Gate)**: No `verifications` or `orders` subcollection document can be created unless the parent `/users/{userId}` document already exists.
3. **Zero-Trust Validation**: Every `create` and `update` must pass `isValidUser`, `isValidVerification`, `isValidOrder`, `isValidStorePackage`, `isValidStoreSettings`, or `isValidStoreOrder` with strict `hasAll`/`hasOnly` key allowlists, string `.size()` bounds, regex ID guards, and `createdAt == request.time` / `updatedAt == request.time` server timestamp checks.
4. **Admin Isolation**: Only the verified store administrator (`request.auth != null && request.auth.token.email_verified == true && request.auth.token.email == 'dnshow53@gmail.com'`) can create, update, or delete `/packages/{packageId}`, update `/storeSettings/group`, or read/write `/storeOrders/{orderId}`.
5. **No PII Exposure on Public Catalog**: `/packages` and `/storeSettings/group` contain strictly non-PII catalog/group configuration; customer PII in `/storeOrders` and `/users` is never publicly readable.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. Unauthenticated read/write to `/users/uid1`.
2. Authenticated non-admin user reading or listing `/storeOrders`.
3. Non-admin or unverified-email user attempting to create or delete `/packages/pkg-hack`.
4. Spoofing admin email with `email_verified: false` to modify `/storeSettings/group`.
5. Creating `/packages/pkg-1` with a ghost field `{ "isFree": true }` or negative `priceBdt: -100`.
6. Creating `/packages/..invalid..` with an ID failing `isValidId()`.
7. Creating `/storeSettings/other` instead of the singleton `/storeSettings/group`.
8. Updating `/packages/pkg-400` with a mutated `id` or `createdAt` timestamp.
9. Creating `/users/uid1/verifications/current` when parent `/users/uid1` does not exist.
10. Updating `/users/uid1/verifications/current` with a 5KB `robloxUsername` string (resource poisoning).
11. Creating `/storeOrders/ord-1` with an invalid status `'Free'` or a 5KB `userName`.
12. Updating `/users/uid1/orders/ord1` once `status` has reached terminal `'completed'`.
