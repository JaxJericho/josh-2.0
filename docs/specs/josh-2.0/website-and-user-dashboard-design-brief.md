# Website And User Dashboard Design Brief (JOSH 2.0)

## Summary

This document specifies the public website and user dashboard for JOSH 2.0, including registration, OTP verification, region gating, pre-launch waitlist behavior, subscription management entry points, and the primary user-facing dashboard surfaces.

JOSH is SMS-first. The website and dashboard exist to:

1. Convert visitors into verified users.  
2. Assign region and enforce gating.  
3. Provide a reliable fallback UI for stateful flows.  
4. Expose user controls (profile updates, LinkUp participation controls, safety controls, subscription).

The experience must be mobile-first, resilient to missing data, consistent with the state machines and contracts in Docs 02–13, and built as a PWA so users can add it to their home screen.

## Goals

* Provide a clear acquisition and registration flow that converts.  
* Verify phone ownership via OTP.  
* Enforce region gating and waitlist flows.  
* Allow users to complete onboarding and manage key preferences.  
* Provide visibility into LinkUps, outcomes, and contact exchange.  
* Provide user safety controls (block/report/help) and subscription management.

## Non-Goals

* Fully native mobile apps.  
* Social feed or community features.  
* Real-time chat UI.

## Key Decisions And Trade-Offs

* SMS-first with dashboard fallback reduces app complexity and improves accessibility.  
* Server-truth UI prevents mismatches and unsafe state transitions.  
* Minimal surface area at launch reduces support load and stabilizes E2E behavior.  
* PWA delivery improves home-screen access without requiring app stores.

## Scope Boundaries

### In Scope

* Public site: landing, how it works, pricing, waitlist/sign up, help/support, legal.  
* Registration: OTP verification, region assignment, gating.  
* Dashboard: LinkUp participation, pause LinkUps, blocked users visibility, update profile trigger, subscription management entry.  
* Contact exchange UI aligned with mutual reveal rules.

### Out Of Scope

* Native iOS/Android apps.  
* Real-time maps, GPS tracking, or location sharing.  
* Live group chat.  
* Full account deletion automation (may start as a request flow).

## Information Architecture

### Public Website

Primary pages:

* Home / Landing  
  * Primary objective: waitlist and registration conversion.  
  * Visitor understands what JOSH is, how it benefits them, and what happens after signup.  
  * Every section includes a CTA that drives to waitlist/registration.  
* How It Works  
  * A complete explanation for new visitors.  
  * Clear description of what JOSH is and is not.  
* Regions (Recommended)  
  * Shows real-time progress for each closed region.  
  * Displays key metrics that matter for opening a region (example: waitlist count, projected launch threshold).  
  * Includes a referrals benefit system concept and explanation. The benefit should drive quality referrals and long-term participation.  
* Pricing  
  * At launch: one tier.  
  * Friends of JOSH: $39.99/month or $399/year.  
* Waitlist / Sign Up  
  * Explanation of what to expect.  
  * The waitlist signup is the same as registration.  
  * The user is registered and OTP verified even in closed regions.  
* Legal  
  * Terms  
  * Privacy  
* Help / Support  
  * Guidance for how JOSH works and common issues.

### User Dashboard

Primary sections (MVP):

* Home  
  * Status \+ next action  
  * LinkUp overview  
  * Blocked users visibility  
  * Buttons:  
    * Update My Profile  
    * Pause LinkUps / Resume LinkUps  
* LinkUps  
  * Upcoming  
  * Past  
  * Invites pending  
  * Pause LinkUps / Resume LinkUps control is available here as well.  
* Safety & Support  
  * Safety guidelines  
  * Support contact form  
  * Commands reference (STOP/START/HELP)  
* Settings  
  * Subscription management entry  
  * Pause LinkUps / Resume LinkUps (duplicate entry allowed for discoverability)  
  * Download data   
  * Delete account request (future)

## PWA Requirements

The site must be a Progressive Web App.

Minimum requirements:

* Web app manifest (name, icons, start URL, display mode, theme colors)  
* Service worker for offline shell caching  
* Install prompt experience tested on mobile browsers  
* Mobile-safe navigation and tap targets  
* Auth and sensitive pages should degrade safely when offline

## Registration And OTP Flow

### Registration Capture

Fields:

* Full Name  
* Phone  
* Birthday  
* Email (optional)  
* Zip Code  
* SMS Consent (checkbox)  
* Age Consent (checkbox)  
* Terms and Privacy acceptance

Validation:

* Phone normalized to E.164.  
* Birthday validates user is over 18\.  
* Consent checkboxes required.

### OTP Verification

* Send OTP via SMS.  
* Verify OTP server-side.  
* Rate limit sends and attempts.

After verification:

* Create or activate user profile.  
* Assign region using zip code mapping.  
* Enter the correct region-gated flow.

## Region Gating And Waitlist UX

### Open Region

After OTP:

* Show dashboard Home with “JOSH will text you to begin” (or “continue”) message.  
* Trigger SMS entry message to start onboarding or continue it.

### Closed Region

After OTP:

* Show “You’re on the waitlist” state.  
* Send a welcome email if the user provided an email address.

Closed region behavior constraints:

* No matching or LinkUp initiation.  
* No profile interview until the region is open.

### Opening Region

* Treat like closed for initiation.  
* Once region flips open:  
  * show a banner  
  * trigger launch messaging

## Onboarding And Profile Management

### Onboarding Entry

* Primary onboarding happens via SMS interview (Doc 06).  
* Dashboard provides:  
  * progress indicator  
  * resume onboarding prompts (if stalled)  
  * limited preference edits:  
    * Gender  
    * Age range

### Profile Update Behavior

Users update profiles via dashboard-triggered SMS:

* Dashboard has Update My Profile.  
* Clicking triggers an SMS from JOSH that asks for changes since last time.  
* The update conversation uses a subset of onboarding steps with stable step IDs.  
* Results are stored as profile events and update the canonical profile.

## Dashboard Home Next Action Logic

The dashboard shows one primary next action at a time.

Priority order:

1. Phone not verified → show OTP verification.  
2. Region closed/opening → show waitlist state.  
3. Profile interview incomplete → show resume conversation.  
4. LinkUps paused → show resume CTA.  
5. Pending LinkUp invite → show RSVP CTA.  
6. Otherwise → show recent activity and “You’re all set” state.

## LinkUps UX

### LinkUps List

* Upcoming  
* Past  
* Invites pending

Each item shows:

* activity title  
* scheduled time  
* status (invited, confirmed, locked, completed)

### LinkUp Detail

* Brief summary (privacy-safe)  
* RSVP controls  
* Time and location guidance (privacy-preserving)  
* Participant count (do not reveal identities before lock)  
* Rules and expectations

### Post-Event Flow

After completion:

* attendance prompt status  
* “do again” and feedback status  
* contact exchange status

The dashboard mirrors SMS state and supports completion if SMS was missed.

## Contact Exchange UX

### Contact Exchange Rules

* Mutual consent required.  
* Users select who they want to exchange contact info with after a LinkUp.  
* The dashboard collects choices and shows outcomes.  
* The interaction aligns with the reveal pattern used elsewhere in the product.

### Contact Exchange View

For a completed LinkUp:

* List participants by first name only or placeholder labels depending on privacy rules.  
* Allow selecting any/all/none.  
* Show pending mutual states.

Once mutual:

* Show revealed contact info.  
* Provide block/report controls.

## Subscription And Billing UX

### Subscription Page

* current plan status  
* renewal date  
* manage subscription (Stripe portal link)  
* entitlements status (simple and user-safe)

If ineligible:

* show a clear call-to-action

### Upgrade Flow

* Redirect to checkout.  
* After return, show “processing” state if webhook pending (Doc 11 grace behavior).

## Safety & Support UX

### Safety Controls

* Block/Unblock user  
* Report user  
* View safety guidelines

Block/report actions must be available from:

* LinkUp detail  
* Contact exchange view

Each action creates the appropriate incident/report records per Doc 13\.

### Help

* STOP/START/HELP explanation  
* contact support form  
* FAQ

## Technical Requirements

### Mobile-First

* Works cleanly on small screens.  
* Avoid dense tables.

### Resilience

* All pages handle empty/missing data gracefully.  
* Clear loading and error states.  
* No page should crash when an API returns empty or delayed data.

### Environment Separation

* Staging and production dashboards are separate.  
* Links, webhooks, and callbacks are environment-aware.

### Security

* Authenticated routes require a valid session.  
* RLS enforced for all user data access.  
* Avoid exposing phone numbers to the client unless required.

## API Contracts

The dashboard calls explicit server endpoints. Representative endpoints:

* `POST /api/register`  
* `POST /api/otp/send`  
* `POST /api/otp/verify`  
* `GET /api/me`  
* `GET /api/region-status`  
* `GET /api/linkups`  
* `GET /api/linkups/{id}`  
* `POST /api/linkups/{id}/rsvp`  
* `POST /api/linkups/{id}/outcomes`  
* `POST /api/linkups/{id}/contact-choices`  
* `GET /api/entitlements`  
* `POST /api/checkout`  
* `POST /api/support`

All actions validate eligibility (Doc 11\) and safety holds (Doc 13).

## Testing Plan

### Unit Tests

* Registration form validation  
* OTP rate limits  
* Region gating rendering logic  
* Next action priority logic  
* Pause LinkUps toggle behavior

### Integration Tests

* registration → OTP → region gating  
* dashboard data loads  
* LinkUp RSVP flow  
* contact exchange submission  
* profile update trigger creates outbound SMS job

### Manual Smoke Tests

* PWA install on iOS and Android browsers  
* mobile layout checks  
* no-data scenarios  
* webhook pending grace UI

## Production Readiness

* `/help` and legal pages linked in footer.  
* instrumentation for conversion funnel.  
* PWA manifest and service worker verified in production.

## Implementation Checklist

* Build landing and registration pages with CTA coverage.  
* Build How It Works and Pricing pages.  
* Build Regions page with region metrics and referral benefit messaging.  
* Build OTP verification.  
* Implement region gating surfaces.  
* Build dashboard home with next action logic.  
* Build Update My Profile trigger that starts an SMS update conversation.  
* Build LinkUps list/detail and RSVP.  
* Build post-event completion surfaces.  
* Build contact exchange UI aligned with reveal interaction.  
* Build subscription management entry and webhook pending state.  
* Build safety controls and support pages.  
* Add analytics and error monitoring tags.  
* Implement PWA shell (manifest, service worker, icons).