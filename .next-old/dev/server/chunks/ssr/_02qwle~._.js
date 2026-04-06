module.exports = [
"[project]/lib/supabase/admin.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createAdminClient",
    ()=>createAdminClient
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$supabase$2f$supabase$2d$js$2f$dist$2f$index$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/@supabase/supabase-js/dist/index.mjs [app-rsc] (ecmascript) <locals>");
;
function createAdminClient() {
    const url = ("TURBOPACK compile-time value", "https://urjhmkhbgaxrofurpbgc.supabase.co");
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error('Supabase service-role env vars are missing.');
    }
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$supabase$2f$supabase$2d$js$2f$dist$2f$index$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__["createClient"])(url, key, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
}
}),
"[project]/app/(app)/admin/users/actions.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/* __next_internal_action_entry_do_not_use__ [{"40089cca9a4163bb68d5b653c4a6f2028c395923f8":{"name":"inviteUserAction"},"4099fe824a06c32f7ed819bdf00e9b881530e61f66":{"name":"setActiveAction"},"40d7ed7c4cc49815fc52223be91993b30265e407a1":{"name":"setRoleAction"}},"app/(app)/admin/users/actions.ts",""] */ __turbopack_context__.s([
    "inviteUserAction",
    ()=>inviteUserAction,
    "setActiveAction",
    ()=>setActiveAction,
    "setRoleAction",
    ()=>setRoleAction
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$server$2d$reference$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/build/webpack/loaders/next-flight-loader/server-reference.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$supabase$2f$server$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/supabase/server.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$supabase$2f$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/supabase/admin.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$cache$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/cache.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/headers.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$action$2d$validate$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/build/webpack/loaders/next-flight-loader/action-validate.js [app-rsc] (ecmascript)");
;
;
;
;
;
async function requireAdmin() {
    const supabase = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$supabase$2f$server$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createClient"])();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated.');
    const { data: profile } = await supabase.from('profiles').select('role, is_active').eq('id', user.id).single();
    if (!profile || profile.role !== 'admin' || !profile.is_active) {
        throw new Error('Not authorised.');
    }
    return {
        supabase,
        user
    };
}
async function inviteUserAction(formData) {
    const email = String(formData.get('email') || '').trim().toLowerCase();
    const role = String(formData.get('role') || 'user');
    const full_name = String(formData.get('full_name') || '').trim();
    const validRoles = [
        'super_admin',
        'admin',
        'supervisor',
        'technician',
        'read_only'
    ];
    if (!email) return {
        error: 'Email is required.'
    };
    if (!validRoles.includes(role)) return {
        error: 'Invalid role.'
    };
    await requireAdmin();
    const h = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["headers"])();
    const host = h.get('origin') ?? h.get('host') ?? '';
    const origin = host.startsWith('http') ? host : `https://${host}`;
    const admin = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$supabase$2f$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createAdminClient"])();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${origin}/auth/reset-password`,
        data: {
            full_name
        }
    });
    if (error) return {
        error: error.message
    };
    // Trigger has already created the profile; set the chosen role.
    if (data.user) {
        await admin.from('profiles').update({
            role,
            full_name: full_name || null
        }).eq('id', data.user.id);
    }
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$cache$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["revalidatePath"])('/admin/users');
    return {
        ok: true
    };
}
async function setActiveAction(formData) {
    const userId = String(formData.get('user_id') || '');
    const isActive = String(formData.get('is_active') || 'true') === 'true';
    if (!userId) return {
        error: 'Missing user.'
    };
    const { user } = await requireAdmin();
    if (userId === user.id && !isActive) {
        return {
            error: 'You cannot deactivate yourself.'
        };
    }
    const admin = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$supabase$2f$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createAdminClient"])();
    const { error } = await admin.from('profiles').update({
        is_active: isActive
    }).eq('id', userId);
    if (error) return {
        error: error.message
    };
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$cache$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["revalidatePath"])('/admin/users');
    return {
        ok: true
    };
}
async function setRoleAction(formData) {
    const userId = String(formData.get('user_id') || '');
    const role = String(formData.get('role') || 'user');
    const validRoles = [
        'super_admin',
        'admin',
        'supervisor',
        'technician',
        'read_only'
    ];
    if (!userId || !validRoles.includes(role)) {
        return {
            error: 'Invalid request.'
        };
    }
    const { user } = await requireAdmin();
    if (userId === user.id && role !== 'admin') {
        return {
            error: 'You cannot demote yourself.'
        };
    }
    const admin = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$supabase$2f$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createAdminClient"])();
    const { error } = await admin.from('profiles').update({
        role
    }).eq('id', userId);
    if (error) return {
        error: error.message
    };
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$cache$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["revalidatePath"])('/admin/users');
    return {
        ok: true
    };
}
;
(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$action$2d$validate$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ensureServerEntryExports"])([
    inviteUserAction,
    setActiveAction,
    setRoleAction
]);
(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$server$2d$reference$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerServerReference"])(inviteUserAction, "40089cca9a4163bb68d5b653c4a6f2028c395923f8", null);
(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$server$2d$reference$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerServerReference"])(setActiveAction, "4099fe824a06c32f7ed819bdf00e9b881530e61f66", null);
(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$server$2d$reference$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerServerReference"])(setRoleAction, "40d7ed7c4cc49815fc52223be91993b30265e407a1", null);
}),
"[project]/.next-internal/server/app/(app)/admin/users/page/actions.js { ACTIONS_MODULE0 => \"[project]/app/(app)/admin/users/actions.ts [app-rsc] (ecmascript)\" } [app-rsc] (server actions loader, ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$app$2f28$app$292f$admin$2f$users$2f$actions$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/app/(app)/admin/users/actions.ts [app-rsc] (ecmascript)");
;
;
;
}),
"[project]/.next-internal/server/app/(app)/admin/users/page/actions.js { ACTIONS_MODULE0 => \"[project]/app/(app)/admin/users/actions.ts [app-rsc] (ecmascript)\" } [app-rsc] (server actions loader, ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "40089cca9a4163bb68d5b653c4a6f2028c395923f8",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$app$2f28$app$292f$admin$2f$users$2f$actions$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["inviteUserAction"],
    "4099fe824a06c32f7ed819bdf00e9b881530e61f66",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$app$2f28$app$292f$admin$2f$users$2f$actions$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["setActiveAction"],
    "40d7ed7c4cc49815fc52223be91993b30265e407a1",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$app$2f28$app$292f$admin$2f$users$2f$actions$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["setRoleAction"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f2e$next$2d$internal$2f$server$2f$app$2f28$app$292f$admin$2f$users$2f$page$2f$actions$2e$js__$7b$__ACTIONS_MODULE0__$3d3e$__$225b$project$5d2f$app$2f28$app$292f$admin$2f$users$2f$actions$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$2922$__$7d$__$5b$app$2d$rsc$5d$__$28$server__actions__loader$2c$__ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i('[project]/.next-internal/server/app/(app)/admin/users/page/actions.js { ACTIONS_MODULE0 => "[project]/app/(app)/admin/users/actions.ts [app-rsc] (ecmascript)" } [app-rsc] (server actions loader, ecmascript) <locals>');
var __TURBOPACK__imported__module__$5b$project$5d2f$app$2f28$app$292f$admin$2f$users$2f$actions$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/app/(app)/admin/users/actions.ts [app-rsc] (ecmascript)");
}),
];

//# sourceMappingURL=_02qwle~._.js.map