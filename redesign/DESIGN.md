# Kunchas interface preview

Status: preview only. Original backup commit c905c92d209124e42af9d66f19b3ba9c7b179cb7. No production deployment.

## Direction

A calm, compact salon operations interface. Retain the plum brand, existing logo, Roboto and current workflows. White navigation, restrained borders, readable figures and clear task hierarchy. Cal.com inspired the restrained spacing; no assets or layouts copied. Apply the awesome-claude-design, web-design and ui-ux-pro-max guidance already reviewed.

## System

Canvas #F7F5F8; surface #FFFFFF; ink #211A2B; muted #655D70; brand #5B1B6F; hover #431451; selected #F3EAF6; divider #DED7E3; control border #716478; success #087454; error #B42335 on #FFF1F2.

Verified contrast against white: ink 16.84:1, muted 6.26:1, brand 11.47:1, success 5.77:1, strong border 5.53:1. Error text against its pale background 5.91:1.

Body 16px/1.5; tables 14px; helpers >=13px; titles 24–36px. Existing Roboto with system fallback. Spacing 4,8,12,16,24,32px; controls radius 8px, cards 12px. Minimum controls 44px. Focus uses a 3px plum outline. Motion 140ms color/border only, disabled for reduced motion.

## Scope and behavior

Only CSS is added to existing application and public booking templates. No IDs, permission rules, calculations, routes, submit handlers, branch mapping or database operations change. Existing hidden and role-based controls remain unchanged. Booking retains its four-step workflow and restrictive public wrapper. Unfinished float work is excluded.

Preview fixture covers dashboard, POS, daily closing and booking using clearly labelled synthetic data. Preview performs no network requests or transaction writes. It illustrates the design and does not substitute for live-app QA.

## Verification and release gate

Removing the two exact CSS insertions reproduces the original main bundle byte-for-byte after line-ending normalization. Booking export wrapper is unchanged. Review desktop and 390px mobile, keyboard focus, long text, error/empty states, 200% zoom and reduced motion before promotion. Command execution is unavailable, so full runtime tests remain blocked. Draft only; do not deploy or merge until reviewed.
