import type { Dictionary } from "@/i18n";

const en: Dictionary = {
  "app.brand": "TravelPlan",
  "header.openMenu": "Open menu",
  // Story 6.20. A new key rather than a reuse of `trips.detail.back`: that one reads "← Back to
  // trips" and keeps both of its readers (the two "trip not found" recovery panels), where the arrow
  // still describes an edge-anchored back link. This row sits in a vertical menu between "Language"
  // and "Sign out", where a leading arrow points at nothing, and it is a destination rather than a
  // way back - so it is named for where it goes.
  "header.trips": "All trips",
  // Story 5.10, AC2. Names the surface rather than the role - "Administration" alone would not say what
  // this administers, and the row is only ever shown to somebody who already is one.
  "header.userAdmin": "User administration",
  "language.label": "Language",
  "language.saveError": "Unable to save language preference.",
  "language.en": "English",
  "language.de": "German",
  "auth.login": "Login",
  "auth.register": "Register",
  "auth.logout": "Sign out",
  "auth.login.title": "Welcome back",
  "auth.login.subtitle": "Sign in to see your trips.",
  "auth.login.success": "Signed in successfully.",
  "auth.login.submit": "Sign in",
  "auth.login.error": "Sign in failed. Please try again.",
  "auth.login.invalidCredentials": "Invalid email or password.",
  "auth.firstLogin.title": "Set your permanent password",
  "auth.firstLogin.subtitle": "Change the temporary password from your invitation before entering the trip planner.",
  "auth.firstLogin.success": "Password updated. Redirecting you into the app.",
  "auth.firstLogin.submit": "Save new password",
  "auth.firstLogin.error": "Unable to update password. Please try again.",
  "auth.firstLogin.initError": "Unable to initialize password change. Please refresh.",
  "auth.firstLogin.passwordLabel": "New password",
  "auth.firstLogin.notRequired": "Password change is no longer required for this account.",
  "auth.register.title": "Create your account",
  "auth.register.subtitle": "Ready in seconds.",
  "auth.register.success": "Account created successfully.",
  "auth.register.submit": "Create account",
  "auth.register.error": "Registration failed. Please try again.",
  "auth.register.emailExists": "An account already exists for this email.",
  "auth.register.initError": "Unable to initialize registration. Please refresh.",
  "auth.forgot.title": "Reset your password",
  "auth.forgot.subtitle": "Enter your email address. We'll send you a link to reset it.",
  "auth.forgot.success": "If an account exists for that email, a reset link has been sent.",
  "auth.forgot.submit": "Send reset link",
  "auth.forgot.error": "Password reset failed. Please try again.",
  "auth.forgot.initError": "Unable to initialize password reset. Please refresh.",
  "auth.reset.title": "Set a new password",
  "auth.reset.subtitle": "Choose a new password for your account.",
  "auth.reset.success": "Password updated. You can now sign in.",
  "auth.reset.submit": "Save password",
  "auth.reset.error": "Password reset failed. Please try again.",
  "auth.reset.initError": "Unable to initialize password reset. Please refresh.",
  "auth.reset.tokenRequired": "Reset token is required",
  "auth.reset.tokenLabel": "Reset token",
  "auth.reset.newPassword": "New password",
  "auth.emailLabel": "Email",
  "auth.passwordLabel": "Password",
  "auth.emailRequired": "Email is required",
  "auth.emailInvalid": "Enter a valid email",
  "auth.passwordRequired": "Password is required",
  "auth.passwordMin": "Password must be at least 8 characters",
  "auth.passwordMax": "Password must be at most 72 characters",
  "auth.consentLabel": "I consent to data storage for trip planning",
  "auth.consentRequired": "Consent is required",
  "auth.tabs.signIn": "Sign in",
  "auth.tabs.register": "Register",
  "auth.emailPlaceholder": "name@example.com",
  "auth.passwordPlaceholderMin": "At least 8 characters",
  "auth.backToLogin": "Back to sign-in",
  "auth.hero.loginTitle": "Plan trips that don't feel like work.",
  "auth.hero.loginSubtitle": "Day plans, stays and budget in one place — together with the people you travel with.",
  "auth.hero.registerTitle": "Your first trip cockpit is waiting.",
  "auth.hero.registerSubtitle": "Register for free and set up your first trip in minutes.",
  "auth.hero.forgotTitle": "No problem — happens to the best of us.",
  "auth.hero.forgotSubtitle": "We'll send you a link that gets you back in under a minute.",
  "auth.hero.resetTitle": "Almost there.",
  "auth.hero.resetSubtitle": "Set a new password and you're back in your trip cockpit.",
  "auth.hero.firstLoginTitle": "One step before you start.",
  "auth.hero.firstLoginSubtitle": "Replace the temporary password from your invitation and the trip is yours.",
  "auth.login.forgotLink": "Forgot password?",
  "auth.login.noAccount": "No account yet?",
  "auth.login.registerLink": "Register now",
  "auth.register.haveAccount": "Already registered?",
  "auth.register.loginLink": "Sign in now",
  "auth.forgot.step": "Step 1 of 2",
  "auth.forgot.rememberedPrefix": "Remembered it?",
  "auth.reset.step": "Step 2 of 2",
  "auth.reset.confirmPassword": "Confirm password",
  "auth.reset.confirmPlaceholder": "Repeat password",
  "auth.reset.confirmRequired": "Please confirm your new password",
  "auth.reset.confirmMismatch": "Passwords do not match",
  "errors.csrfMissing": "Security token missing. Please refresh and try again.",
  "errors.csrfInvalid": "Invalid security token. Please refresh and try again.",
  "errors.network": "Unable to reach the server. Please try again.",
  "errors.rateLimited": "Too many attempts. Please try again later.",
  "errors.server": "Something went wrong. Please try again.",
  "errors.invalidJson": "Request could not be processed. Please try again.",
  "errors.unauthorized": "Authentication required. Please sign in.",
  "errors.forbidden": "Your role on this trip does not allow this action.",
  "demo.title": "Plan with calm clarity",
  "home.kicker": "Plan with calm clarity",
  "home.title": "A trip planner that keeps the whole journey in view.",
  "home.subtitle": "Organize stays, daily plans, and costs in one clear timeline. Start with the skeleton, fill the details, and see gaps disappear.",
  "home.cta.createAccount": "Create account",
  "home.cta.signIn": "Sign in",
  "home.howItWorks.kicker": "How it works",
  "home.howItWorks.title": "A calm, four-step planning flow.",
  "home.howItWorks.intro": "Start with the trip outline, add what you know, and let the timeline reveal what still needs attention.",
  "home.howItWorks.step1.title": "Set the date range",
  "home.howItWorks.step1.body": "Start a trip with start and end dates to generate the full timeline instantly.",
  "home.howItWorks.step2.title": "Add stays and anchors",
  "home.howItWorks.step2.body": "Drop in lodging and fixed plans so the core structure feels real right away.",
  "home.howItWorks.step3.title": "Fill day-by-day plans",
  "home.howItWorks.step3.body": "Layer in activities, notes, and links to keep each day clear and actionable.",
  "home.howItWorks.step4.title": "Review gaps and costs",
  "home.howItWorks.step4.body": "Use the timeline to spot open days, missing stays, and budget totals at a glance.",
  "trips.page.title": "Your trips",
  "trips.dashboard.title": "Trips in progress",
  "trips.dashboard.addTrip": "Add trip",
  "trips.dashboard.empty": "No trips yet. Select Add trip to start building your plan.",
  "trips.dashboard.loadError": "Unable to load trips.",
  "trips.dashboard.dayCount": "{count} days",
  "trips.dashboard.subline": "{tripCount} trips · {gapTripCount} with open items",
  // `formatMessage` has no plural support, so every count-bearing string needs its own singular twin.
  "trips.dashboard.sublineOne": "1 trip · {gapTripCount} with open items",
  "trips.dashboard.statActiveTrips": "Active trips",
  "trips.dashboard.statTotalCost": "Costs so far (all trips)",
  "trips.dashboard.statOpenItems": "Open items",
  // `formatMessage` is a plain {key} substituter with no plural support, so the singular is its own
  // key rather than a fixed plural - "1 Tage offen" would be a visible defect in the primary language.
  "trips.dashboard.statusGap": "{count} days open",
  "trips.dashboard.statusGapOne": "1 day open",
  "trips.dashboard.statusPlanned": "Fully planned",
  "trips.dashboard.statusUpcoming": "Upcoming · planning open",
  "trips.dashboard.statusPast": "Completed",
  "trips.dashboard.costSoFar": "Costs so far",
  "trips.dashboard.costTotal": "Total costs",
  "trips.dashboard.openTripAria": "Open trip {trip}",
  "trips.dashboard.openSharedTripAria": "Open trip {trip}, shared with you as {role}",
  "trips.create.title": "Create a new trip",
  "trips.create.helper": "Give your trip a name and a date range to generate a full set of planning days.",
  "trips.create.submit": "Create trip",
  "trips.create.initError": "Unable to initialize trip creation. Please refresh.",
  "trips.create.error": "Trip creation failed. Please try again.",
  "trips.create.success": "Trip created with {count} days.",
  "trips.create.uploadError": "Trip created, but the hero image upload failed. Please try again.",
  "trips.form.name": "Trip name",
  "trips.form.namePlaceholder": "e.g. Spring in Kyoto",
  "trips.form.startDate": "Start date",
  "trips.form.endDate": "End date",
  "trips.form.startLocation": "Start location (optional)",
  "trips.form.destinationLocation": "Destination (optional)",
  "trips.form.locationResolveError": "Resolve this location before creating the trip",
  "trips.form.heroImage": "Hero image (optional)",
  "trips.form.heroImageHelper": "JPEG, PNG, or WebP up to 5MB.",
  "trips.form.nameRequired": "Trip name is required",
  "trips.form.dateRequired": "Date is required",
  "trips.form.dateInvalid": "Use YYYY-MM-DD or DD.MM.YYYY",
  "trips.edit.title": "Edit trip",
  "trips.edit.submit": "Save changes",
  "trips.edit.open": "Edit trip",
  "trips.edit.initError": "Unable to initialize edit form. Please refresh.",
  "trips.edit.error": "Trip update failed. Please try again.",
  "trips.edit.uploadError": "Trip updated, but the hero image upload failed. Please try again.",
  "trips.delete.title": "Delete trip?",
  "trips.delete.body": "This will remove “{name}” and all of its days. This action cannot be undone.",
  "trips.delete.submit": "Delete trip",
  // Story 6.25 AC3. The safe half of a destructive confirmation, and it names the outcome it
  // preserves rather than the mechanism — "Keep trip" beside "Delete trip" is two results side by
  // side, where "Cancel" beside "Delete trip" asked the reader to work out *what* was being
  // cancelled: the question, or the deletion? See EXPERIENCE.md.Voice and Tone.
  "trips.delete.keep": "Keep trip",
  "trips.delete.open": "Delete trip",
  // `.open` rather than the `.action` Story 7.8 retired: across this block `.action` is a dialog's
  // submit label ("Start import") while `.open` is the trigger that sits in a card ("Import backup",
  // "Edit trip", "Delete trip"). Export opens no dialog, so it is a trigger.
  "trips.export.open": "Export backup",
  "trips.export.error": "Trip export failed. Please try again.",
  "trips.import.open": "Import backup",
  "trips.import.action": "Start import",
  // Story 6.25. The post-import footer's acknowledgement. It read `common.close` until the title-row
  // `✕` arrived and put two controls named "Close" in one dialog, which a screen reader cannot
  // distinguish. "Done" also names the outcome rather than the mechanism — Voice and Tone.
  "trips.import.done": "Done",
  "trips.import.title": "Import trip backup",
  "trips.import.fileLabel": "Backup file",
  "trips.import.fileHelp": "Select a .zip backup exported from TravelPlan. Older .json backups still work.",
  "trips.import.fileRequired": "Please select a backup file.",
  "trips.import.fileTooLarge": "Backup file is larger than {limit} MB.",
  "trips.import.invalidFile": "That file is not a TravelPlan backup. Select a .zip or .json export.",
  "trips.import.validationError": "This backup could not be read. It may be incomplete or damaged.",
  "trips.import.uploadFailed": "The upload did not arrive complete. Please try sending the file again.",
  "trips.import.issuesHeading": "What the server found",
  "trips.import.issuesTruncated": "and {count} more",
  "trips.import.warningsHeading": "Missing from this backup",
  "trips.import.targetMissing": "The trip to overwrite no longer exists.",
  "trips.import.targetInvalid": "That trip can no longer be overwritten. Pick another one or create a new trip.",
  "trips.import.conflictError": "Trip with this name already exists.",
  "trips.import.conflictHelp": "Choose how to resolve this conflict.",
  "trips.import.conflictSelectLabel": "Trip to overwrite",
  "trips.import.strategyOverwrite": "Overwrite existing trip",
  "trips.import.strategyCreateNew": "Create new trip",
  "trips.import.successCreated": "Imported “{name}” as a new trip.",
  "trips.import.successOverwritten": "Replaced the existing trip “{name}”.",
  "trips.import.summaryDays": "Days",
  "trips.import.summaryPhotos": "Photos",
  "trips.import.summaryDocuments": "Documents",
  "trips.import.summarySegments": "Travel segments",
  "trips.import.summaryBucket": "Bucket list",
  "trips.import.error": "Trip import failed. Please try again.",
  "trips.import.initError": "Unable to initialize import. Please refresh.",
  "trips.delete.initError": "Unable to initialize deletion. Please refresh.",
  "trips.delete.error": "Trip deletion failed. Please try again.",
  "trips.detail.back": "← Back to trips",
  "trips.detail.title": "Trip timeline",
  "trips.detail.subtitle": "Review each day and keep your itinerary organized.",
  "trips.detail.notFoundTitle": "Trip not found",
  "trips.detail.notFoundBody": "This trip might have been deleted or you may not have access to it.",
  "trips.detail.loadError": "Unable to load trip.",
  "trips.share.open": "Share trip",
  "trips.share.title": "Share trip",
  "trips.share.subtitle": "Invite access by email",
  "trips.share.inviteLabel": "Invite person",
  "trips.share.accessLabel": "Access ({count})",
  "trips.share.roleLabel": "Role",
  "trips.share.roleViewer": "Viewer",
  "trips.share.roleContributor": "Contributor",
  "trips.share.roleOwner": "Owner",
  "trips.share.temporaryPasswordOptionalLabel": "Temporary password (new accounts only)",
  "trips.share.temporaryPasswordHelp": "Required only when creating a brand-new account. Existing accounts keep their current password.",
  "trips.share.submit": "Invite",
  "trips.share.remove": "Remove",
  "trips.share.removeAria": "Remove {email}",
  "trips.share.empty": "No collaborators added yet.",
  "trips.share.success": "Collaborator added successfully.",
  "trips.share.removeSuccess": "Access removed.",
  "trips.share.linkSuccess": "Collaborator linked successfully.",
  "trips.share.validationError": "Check the collaborator details and try again.",
  "trips.share.duplicateError": "This person is already linked to the trip.",
  "trips.share.ownerEmailError": "You cannot add the trip owner's email as a collaborator.",
  "trips.share.error": "Unable to add collaborator. Please try again.",
  "trips.share.removeError": "Unable to remove collaborator. Please try again.",
  "trips.share.initError": "Unable to load sharing controls. Please refresh.",
  "trips.share.viewRegisteredUsers": "View all registered users",
  // No leading "←" glyph, unlike its siblings here. Story 6.19 moved this label out of a button in
  // the day hero's top-left corner and into the first row of the hero's `⋯` menu, where the arrow
  // pointed at a shape that no longer exists: menu rows read as a vertical list of destinations, not
  // as a back affordance anchored to an edge. The wording is unchanged, so the command is still named
  // the same thing - only the decoration went. The day-not-found card shares this key and loses the
  // glyph with it, which is correct for the same reason: it is a standalone action in a card, not a
  // back link pinned to the top-left of a page. `trips.detail.back`, `trips.costOverview.back` and
  // `trips.overviewMap.back` keep theirs - those are still edge-anchored back links.
  "trips.dayView.back": "Back to trip",
  "trips.dayView.mapBack": "← Back to day",
  "trips.dayView.title": "Day {index}",
  "trips.dayView.titleWithNote": "Day {index}: {note}",
  "trips.dayView.notFoundTitle": "Day not found",
  "trips.dayView.notFoundBody": "This day might have been removed or you may not have access to it.",
  "trips.dayView.loadError": "Unable to load day details.",
  "trips.dayView.previousAria": "Go to previous day",
  "trips.dayView.nextAria": "Go to next day",
  "trips.dayView.timelineTitle": "Day timeline",
  "trips.dayView.timelineEmpty": "No day details yet. Add a stay or day plan item to begin.",
  "trips.dayView.previousNightTitle": "Previous night accommodation",
  "trips.dayView.previousNightEmpty": "No previous-night accommodation set.",
  "trips.dayView.activitiesTitle": "Day activities",
  "trips.dayView.activitiesEmpty": "No activities planned yet.",
  "trips.dayView.currentNightTitle": "Current night accommodation",
  "trips.dayView.currentNightEmpty": "No current-night accommodation set.",
  "trips.dayView.coverageLegendStay": "Accommodation",
  "trips.dayView.coverageLegendActivity": "Activity",
  "trips.dayView.coverageLegendTravel": "Travel",
  "trips.dayView.coverageLegendGap": "Open",
  "trips.dayView.coverageAxisDescription": "The coverage bar spans the full day, from 00:00 to 24:00.",
  "trips.dayView.approxTimeRange": "approx. {range}",
  "trips.dayView.statDay": "Day",
  "trips.dayView.statDayValue": "{index} / {total}",
  "trips.dayView.statTravelTime": "Travel time",
  "trips.dayView.statSpendToday": "Spend",
  "trips.dayView.statCheckInGeneric": "Check-in",
  "trips.dayView.costCardTitle": "Costs today",
  "trips.dayView.costCardSubtitle": "expenses recorded so far, day {index}",
  "trips.dayView.mapCaption": "{count} stops · open the full map",
  "trips.dayView.mapCaptionOne": "1 stop · open the full map",
  "trips.dayView.budgetItemPreviousNight": "Previous night: {name}",
  "trips.dayView.budgetItemCurrentNight": "Current night: {name}",
  "trips.dayView.budgetItemPlan": "Activity {index}",
  "trips.dayView.budgetNoAmount": "No cost captured",
  "trips.dayView.budgetEmpty": "No budget entries for this day yet.",
  "trips.dayView.mapTitle": "Day map",
  "trips.dayView.mapExpand": "Expand map",
  "trips.dayView.mapDialogTitle": "Map details",
  "trips.dayView.mapEmptyTitle": "No locations to map yet",
  "trips.dayView.mapEmptyBody": "Add locations to stays or plan items to see the route.",
  "trips.dayView.mapMissingTitle": "Missing locations",
  "trips.dayView.mapMissingTag": "Missing",
  "trips.dayView.routingUnavailableTitle": "Routing unavailable",
  "trips.dayView.routingUnavailableBody": "Showing direct line order. Check your connection and try again.",
  "trips.dayView.ganttAriaLabel": "Day schedule overview",
  "trips.dayView.ganttSummary": "Planned {planned}, Unplanned {unplanned}",
  "trips.dayView.ganttSummaryAssumed": "Planned {planned}, Unplanned unknown until a check-in time is set",
  "trips.dayView.ganttFullyPlanned": "Fully planned day",
  "trips.dayView.ganttHoursMinutes": "{hours}h {minutes}m",
  "trips.dayView.ganttHours": "{hours}h",
  "trips.dayView.ganttMinutes": "{minutes}m",
  "trips.dayView.moreActions": "More actions",
  "trips.dayView.printAction": "Print day",
  "trips.dayPrint.back": "← Back to day",
  "trips.dayPrint.loadError": "Unable to load day for printing.",
  "trips.dayTransfer.moveAction": "Move activities",
  "trips.dayTransfer.swapAction": "Swap activities",
  "trips.dayTransfer.moveDescription": "Move all activities from this day to another day. Accommodation stays on its original date.",
  "trips.dayTransfer.swapDescription": "Swap all activities between this day and another day. Accommodation stays on its original date.",
  "trips.dayTransfer.targetLabel": "Target day",
  "trips.dayTransfer.moveOverwriteWarning": "Activities already exist on the selected day. Moving will delete them before reassignment.",
  "trips.dayTransfer.confirmMove": "Confirm move",
  "trips.dayTransfer.confirmSwap": "Confirm swap",
  "trips.dayTransfer.sameDayError": "Select a different day for this transfer.",
  "trips.dayTransfer.moveError": "Unable to move activities. Please try again.",
  "trips.dayTransfer.swapError": "Unable to swap activities. Please try again.",
  "trips.costOverview.back": "← Back to trip",
  "trips.costOverview.title": "Cost overview",
  "trips.costOverview.columnDay": "Day",
  "trips.costOverview.columnItems": "Cost positions",
  "trips.costOverview.columnDayTotal": "Day total",
  "trips.costOverview.empty": "No costs captured for this trip yet.",
  "trips.costOverview.emptyDay": "No cost positions yet.",
  "trips.costOverview.emptyMonths": "No open costs scheduled yet.",
  "trips.costOverview.modeLabel": "Cost overview mode",
  "trips.costOverview.modeDays": "Days",
  "trips.costOverview.modeMonths": "Months",
  "trips.costOverview.monthTotalLabel": "Month total: {total}",
  "trips.costOverview.tripTotalLabel": "Trip total: {total}",
  "trips.costOverview.openAria": "Open cost overview",
  "trips.travelSegment.addPrompt": "Add travel segment",
  "trips.travelSegment.addAction": "Add travel",
  "trips.travelSegment.editAction": "Edit travel",
  "trips.travelSegment.addTitle": "Add travel segment",
  "trips.travelSegment.editTitle": "Edit travel segment",
  "trips.travelSegment.fromLabel": "From",
  "trips.travelSegment.toLabel": "To",
  "trips.travelSegment.transportLabel": "Transport",
  // Story 6.18 replaced the single "Duration (HH:mm)" field with an hours box and a minutes box, so
  // there is no longer one label to carry. Both are short on purpose: they sit side by side inside
  // one column of a dialog that has to fit a 390px phone, and each is its field's accessible name.
  "trips.travelSegment.durationHoursLabel": "Duration (h)",
  "trips.travelSegment.durationMinutesLabel": "Duration (min)",
  "trips.travelSegment.distanceLabel": "Distance (km)",
  "trips.travelSegment.distanceOptionalLabel": "Distance (km, optional)",
  // Story 6.30: both distance errors name the one-decimal cap and carry the same both-separators
  // example, because the distance field's `helperText` is error-only - these two strings *are* its
  // helper, and a refusal that does not say what is accepted leaves the user no next move.
  //
  // "1000 not 1.000" is there for the case the cap exists for, and it is the half that is easy to
  // leave out. Someone typing `1,000` believes they typed a *thousand*, not a decimal, so "at most one
  // decimal" describes a rule they do not think they broke and leaves them nothing to try. Naming the
  // repair is what turns the refusal into the visible question the cap was for.
  "trips.travelSegment.distanceInvalid":
    "Enter a distance greater than 0 with at most one decimal: 12.5 or 12,5, and 1000 not 1.000, or leave empty.",
  "trips.travelSegment.linkLabel": "Link (optional)",
  "trips.travelSegment.linkHelper": "Paste a Google Maps or other directions link",
  "trips.travelSegment.linkInvalid": "Enter a valid http(s) link",
  // Story 6.17: the three dialog-action labels are deliberately identical in both dictionaries.
  // "Maps", "Plan" and "OK" are words German uses unchanged, and the dialog's action row has to fit
  // a 390px phone, where "Plan with Maps" / "Speichern" wrapped mid-row.
  "trips.travelSegment.calculateGoogleMapsRoute": "Plan",
  "trips.travelSegment.refreshGoogleMapsRoute": "Plan",
  // Story 6.17: `trips.travelSegment.save`, not `common.save`. This is the one dialog whose save
  // button says "OK"; a `common.` key with that value would hand the next dialog an OK button.
  "trips.travelSegment.save": "OK",
  "trips.travelSegment.googleMapsUnavailableHelper":
    "Add a location to both adjacent items.",
  "trips.travelSegment.googleMapsManualModeHelper":
    "Automatic route import covers car, walking and cycling. Ship and flight are entered manually.",
  "trips.travelSegment.googleMapsNoRouteForMode":
    "No route is available for this travel mode between these two places. Enter the duration and distance manually.",
  "trips.travelSegment.googleMapsFallbackActive":
    "Route import failed. Enter duration and distance manually.",
  "trips.travelSegment.googleMapsPrefillSuccess":
    "Route details were prefilled from Maps.",
  "trips.travelSegment.openLink": "Maps",
  "trips.travelSegment.durationRequired": "Duration is required",
  "trips.travelSegment.distanceRequired": "Distance is required for car travel",
  "trips.travelSegment.distancePositive":
    "Enter a distance greater than 0 with at most one decimal: 12.5 or 12,5, and 1000 not 1.000",
  "trips.travelSegment.initError": "Unable to initialize travel segment editor. Please refresh.",
  "trips.travelSegment.saveError": "Travel segment update failed. Please try again.",
  "trips.travelSegment.kmSuffix": "km",
  "trips.travelSegment.transport.car": "Car",
  "trips.travelSegment.transport.ship": "Ship",
  "trips.travelSegment.transport.flight": "Flight",
  "trips.travelSegment.transport.walking": "Walking",
  "trips.travelSegment.transport.cycling": "Cycling",
  "trips.dayImage.title": "Day image",
  "trips.dayImage.empty": "No day image selected yet.",
  "trips.dayImage.editAction": "Edit day details",
  "trips.dayImage.dialogTitle": "Edit day details",
  "trips.dayImage.fileLabel": "Day image",
  "trips.dayImage.fileHelper": "Upload JPEG, PNG, or WebP up to 15MB.",
  // Re-added by 7.7 (AC7). 7.3 dropped it when the day *hero* became decorative; the editing dialog's
  // preview is not — it is the only confirmation a non-sighted owner gets that an upload landed.
  "trips.dayImage.previewAlt": "Current day image",
  "trips.dayImage.noteLabel": "Day note",
  "trips.dayImage.noteHelper": "Optional short note for this day (max 280 characters)",
  "trips.dayImage.saveAction": "Save day details",
  "trips.dayImage.removeAction": "Remove image",
  "trips.dayImage.invalidUrl": "Enter a valid image URL.",
  "trips.dayImage.uploadError": "Day image upload failed. Please try again.",
  "trips.image.unsupportedFormat": "Unsupported image format. Please choose a JPEG, PNG, or WebP file.",
  "trips.dayImage.saveError": "Day image update failed. Please try again.",
  "trips.timeline.title": "Day list",
  "trips.timeline.empty": "No days found for this trip yet.",
  "trips.timeline.missingPlan": "Missing plan",
  "trips.timeline.dayLabel": "Day {index}",
  "trips.timeline.openDay": "Open day view",
  "trips.timeline.openDayNamed": "Open day view: {day}",
  "trips.timeline.activeTripKicker": "Active trip",
  "trips.timeline.noAccommodation": "No accommodation",
  "trips.timeline.costSummaryTitle": "Cost so far",
  "trips.timeline.costSummarySubtitle": "expenses recorded so far · whole trip",
  "trips.timeline.costAccommodationLine": "Accommodation",
  "trips.timeline.costActivitiesLine": "Activities & excursions",
  "trips.timeline.statDuration": "Duration",
  "trips.timeline.statStations": "Stations",
  "trips.timeline.statOpenItems": "Open items",
  "trips.timeline.gapAlertTitle": "Action needed: Day {dayIndex}",
  "trips.timeline.gapAlertBody": "No accommodation has been recorded yet for day {dayIndex} ({date}).",
  "trips.overviewMap.title": "Route",
  "trips.overviewMap.expand": "Expand map",
  "trips.overviewMap.back": "← Back to trip overview",
  "trips.overviewMap.emptyTitle": "No mapped places yet",
  "trips.overviewMap.emptyBody": "Add locations to stays or plan items to see markers here.",
  "trips.overviewMap.missingTitle": "Missing locations",
  "trips.overviewMap.missingTag": "Missing",
  "trips.overviewMap.popupStay": "Stay",
  "trips.overviewMap.popupPlanItem": "Plan item",
  "trips.overviewMap.popupNoNotes": "No notes added for this stay.",
  "trips.overviewMap.openLinkedItem": "Open details",
  "trips.bucketList.title": "Bucket list",
  "trips.bucketList.addAction": "Add item",
  "trips.bucketList.addToDayAction": "Add to day",
  "trips.bucketList.loading": "Loading bucket list...",
  "trips.bucketList.empty": "No bucket list items yet.",
  "trips.bucketList.loadError": "Unable to load bucket list items.",
  "trips.bucketList.countLine": "{count} entries",
  "trips.bucketList.expandAction": "Expand bucket list",
  "trips.bucketList.collapseAction": "Collapse bucket list",
  "trips.bucketList.locationMissing": "No coordinates saved",
  "trips.bucketList.addTitle": "Add bucket list item",
  "trips.bucketList.editTitle": "Edit bucket list item",
  "trips.bucketList.saveNew": "Save item",
  "trips.bucketList.saveUpdate": "Update item",
  "trips.bucketList.saveError": "Bucket list update failed. Please try again.",
  "trips.bucketList.deleteError": "Bucket list item removal failed. Please try again.",
  "trips.bucketList.titleLabel": "Title",
  "trips.bucketList.descriptionLabel": "Description",
  "trips.bucketList.positionLabel": "Position text",
  "trips.bucketList.editAction": "Edit item",
  "trips.bucketList.deleteAction": "Delete item",
  "trips.bucketList.deleteTitle": "Delete bucket list item?",
  "trips.bucketList.deleteBody": "This will remove the item from your trip bucket list.",
  "trips.bucketList.deleteConfirm": "Delete item",
  // Story 6.25 AC3, the second of the two carved-out confirmations. Same rule as
  // `trips.delete.keep`: the safe half names what it preserves.
  "trips.bucketList.deleteKeep": "Keep item",
  "trips.plan.addAction": "Add plan",
  "trips.plan.editAction": "Edit plan",
  "trips.plan.addPrimaryAction": "Add plan item",
  "trips.plan.title": "Day {index} plan",
  "trips.plan.addDialogTitle": "Add plan item",
  "trips.plan.editDialogTitle": "Edit plan item",
  "trips.plan.itemsTitle": "Plan items",
  "trips.plan.empty": "No plan items yet.",
  "trips.plan.newItem": "New item",
  "trips.plan.addItem": "Add item",
  "trips.plan.editItem": "Edit item",
  // Story 6.24 AC6. `saveNew` ("Save item") and `saveUpdate` ("Update item") both became "OK", so
  // they are collapsed into one key rather than kept as two names for one word — the shape Story
  // 6.17 called a trap on `common.save`. Dialog-specific and not `common.ok` for that story's other
  // reason: a `common.` name invites the next dialog to inherit an OK button it never decided on.
  "trips.plan.save": "OK",
  // `trips.plan.deleteItem` ("Delete") left with it: Story 6.24 AC5 turned the footer's delete into
  // a trash glyph, and `deleteItemAria` below is the word it carries instead. The visible label had
  // exactly one reader and would otherwise sit here waiting to be picked up by a second.
  // Carries the activity's title because the accessible name now belongs to the whole card rather
  // than to a pencil sitting inside it: a timeline of eight cards all named "Edit plan item" tells a
  // screen-reader user nothing about which one they are on.
  "trips.plan.editItemAria": "Edit plan item: {title}",
  "trips.plan.deleteItemAria": "Delete plan item",
  "trips.plan.deleteConfirm": "Delete this plan item?",
  // Story 6.24 AC3a / EXPERIENCE.md.State Patterns → "Dismissing a dialog with unsaved input", and
  // Story 6.25 AC7, which carries the same pattern to nine more form dialogs.
  //
  // Only the body stays dialog-specific: it is the one line that can name the object it is about to
  // throw away ("this plan item"), which is what "names what goes" asks for. The title, the safe
  // answer and the discard action say the same three things on every surface, so they moved to
  // `common.discard.*` rather than being retyped ten times.
  "trips.plan.discardBody": "Your changes to this plan item will be discarded.",
  // Story 6.22. The activity dialog's four sections, in tab order. Kept short because four of them
  // share one 390px row: the German set ("Was", "Wann & Wo", "Kosten", "Medien & Links") is the
  // binding one and no label here may grow past its width.
  "trips.plan.tabsLabel": "Plan item sections",
  "trips.plan.tabWhat": "What",
  "trips.plan.tabWhenWhere": "When & where",
  "trips.plan.tabCost": "Cost",
  "trips.plan.tabMedia": "Media & links",
  // The tab's accessible name when one of its fields is in error, so the marker is not a
  // sighted-only signal. The visible marker is a warning triangle, never colour alone.
  "trips.plan.tabWithErrors": "{label} (contains errors)",
  // AC1 says no tab holds a single control. The gallery only exists once the item has an id, so in
  // the add flow this tab would otherwise be one URL box: the line explains the absence instead of
  // showing an upload zone that cannot upload.
  "trips.plan.galleryAfterSave": "You can add photos once this plan item is saved.",
  "trips.plan.documentsAfterSave": "You can add documents once this plan item is saved.",
  "trips.plan.contentLabel": "Plan notes",
  "trips.plan.contentHelper": "Add notes for this day.",
  "trips.plan.editorLoading": "Loading editor...",
  "trips.plan.toolbarBold": "Bold",
  "trips.plan.toolbarItalic": "Italic",
  "trips.plan.toolbarBulletList": "Bullets",
  "trips.plan.toolbarLink": "Link",
  "trips.plan.toolbarImage": "Image",
  "trips.plan.toolbarLinkPrompt": "Enter a link URL",
  "trips.plan.toolbarImagePrompt": "Enter an image URL",
  "trips.plan.inlineImageAlt": "Plan image",
  "trips.plan.titleLabel": "Title",
  "trips.plan.titleHelper": "Required short title (max 120 characters)",
  // Story 6.18 deleted `fromTimeHelper` / `toTimeHelper`. They read "Required start time (HH:mm)"
  // and had no reader in `src/` — dead hints for a free-text field these two labels stopped
  // belonging to when the day-plan dialog went native `type="time"`.
  "trips.plan.fromTimeLabel": "From",
  "trips.plan.toTimeLabel": "To",
  "trips.plan.costLabel": "Cost",
  "trips.plan.costHelper": "Optional amount (e.g. 10.00 or 10,00)",
  "trips.plan.costInvalid": "Enter an amount like 10.00 or 10,00 — at most 2 decimals",
  "trips.plan.linkLabel": "Link",
  "trips.plan.linkHelper": "Optional external link",
  "trips.plan.linkOpen": "Open link",
  "trips.plan.noLink": "No link",
  "trips.plan.previewFallback": "Plan item",
  "trips.plan.loading": "Loading plan items...",
  "trips.plan.initError": "Unable to initialize plan editor. Please refresh.",
  "trips.plan.loadError": "Unable to load plan items.",
  "trips.plan.saveError": "Plan item update failed. Please try again.",
  "trips.plan.deleteError": "Plan item removal failed. Please try again.",
  "trips.plan.editItemMissing": "Missing plan item to edit.",
  // Story 6.23 — moving one activity to another day, from the activity dialog's footer. Distinct
  // from `trips.dayTransfer.*`, which is the whole-day transfer and whose "move" *replaces* the
  // target day — the two must not share copy any more than they share code.
  //
  // Story 6.24 AC7 shortened the action to "anderer Tag" / "Another day" so the footer fits one row.
  // The German is the binding one and is deliberately lower-case: it is the wording the request
  // itself used. English keeps sentence case, like every other English label in this file. The full
  // sentence still reaches the user one step later, on `moveDialogTitle`.
  "trips.plan.moveAction": "Another day",
  "trips.plan.moveDialogTitle": "Move to another day",
  "trips.plan.moveDescription":
    "Everything saved on this activity moves with it: title, description, times, cost, payments, link, location and photos. Activities already on the selected day are kept.",
  // The two costs of moving, said before the move rather than after it. Unsaved edits: the move sends
  // the activity as it was last saved, and this dialog can be opened with the form dirty. Travel
  // segments: they carry a duration, a distance and sometimes a link somebody typed, and AC4's
  // principle - do not remove that in silence - applies to the warning as much as the receipt.
  "trips.plan.moveWarning":
    "Unsaved changes in this dialog are not moved. Travel segments between this activity and its neighbours are removed on both days.",
  "trips.plan.moveConfirm": "Move activity",
  "trips.plan.moveError": "Unable to move the activity. Please try again.",
  // The day is named when it can be resolved; this stands in when it cannot, so the sentence never
  // ends up reading "Activity moved to ."
  "trips.plan.moveFallbackDay": "another day",
  // Two messages, not one with a zero case: removing something the user typed has to be named, and a
  // move that removed nothing should not mention travel segments at all. The count-bearing one gets
  // its own singular twin, as every count-bearing string in this file does - `formatMessage` has no
  // plural support and "1 travel segment(s) removed" would be a visible defect.
  "trips.plan.moveSuccess": "Activity moved to {day}.",
  "trips.plan.moveSuccessWithSegment": "Activity moved to {day}. 1 travel segment removed.",
  "trips.plan.moveSuccessWithSegments": "Activity moved to {day}. {count} travel segments removed.",
  "trips.payments.title": "Payment schedule",
  "trips.payments.payAllNow": "Pay all now",
  "trips.payments.split": "Split into multiple payments",
  "trips.payments.amountLabel": "Amount",
  "trips.payments.dateLabel": "Due date",
  "trips.payments.addAction": "Add payment",
  "trips.payments.removeAction": "Remove",
  "trips.payments.sumMismatch": "Payments must add up to the total cost",
  "trips.payments.dateRequired": "Payment date is required",
  "trips.payments.amountRequired": "Payment amount is required",
  "trips.payments.amountInvalid": "Enter a valid amount",
  "trips.payments.minRows": "Add at least two payments for a split schedule",
  "trips.payments.costRequired": "Enter a total cost before adding payments",
  "trips.stay.copyPreviousAction": "Copy previous night",
  // Story 6.13: the stay cards are their own edit target, so these name the stretched overlay rather
  // than a visible button. Add and edit are separate strings on purpose - an empty accommodation card
  // and a filled one are indistinguishable to a screen reader once the name is all it has.
  "trips.stay.editPreviousNightAria": "Edit previous-night accommodation: {title}",
  "trips.stay.addPreviousNightAria": "Add previous-night accommodation",
  "trips.stay.editCurrentNightAria": "Edit current-night accommodation: {title}",
  "trips.stay.addCurrentNightAria": "Add current-night accommodation",
  "trips.stay.addTitle": "Add stay",
  "trips.stay.editTitle": "Edit stay",
  "trips.stay.nameLabel": "Stay name",
  "trips.stay.statusLabel": "Status",
  "trips.stay.statusPlanned": "Planned",
  "trips.stay.statusBooked": "Booked",
  "trips.stay.costLabel": "Cost",
  "trips.stay.costHelper": "Optional amount (e.g. 10.00 or 10,00)",
  "trips.stay.costInvalid": "Enter an amount like 10.00 or 10,00 — at most 2 decimals",
  "trips.stay.costTooHigh": "Cost is too high",
  "trips.stay.linkLabel": "Link",
  "trips.stay.linkHelper": "Optional booking link",
  "trips.stay.linkInvalid": "Enter a valid http(s) link",
  "trips.stay.checkInLabel": "Check-in time",
  "trips.stay.checkOutLabel": "Check-out time",
  "trips.stay.timeInvalid": "Enter time as HH:mm",
  "trips.stay.linkOpen": "Open link",
  "trips.stay.notesLabel": "Notes",
  "trips.stay.save": "Save stay",
  "trips.stay.delete": "Remove stay",
  "trips.stay.initError": "Unable to initialize stay editor. Please refresh.",
  "trips.stay.error": "Stay update failed. Please try again.",
  "trips.stay.deleteError": "Stay removal failed. Please try again.",
  "trips.stay.nameRequired": "Stay name is required",
  // Story 6.26 — see the note on the German side for why these are not shared with `trips.plan.*`.
  "trips.stay.tabsLabel": "Stay sections",
  "trips.stay.tabBasics": "Basics",
  "trips.stay.tabCost": "Cost",
  "trips.stay.tabPlace": "Place & notes",
  "trips.stay.tabMedia": "Media & links",
  "trips.stay.tabWithErrors": "{label} (contains errors)",
  "trips.stay.galleryAfterSave": "You can add photos once this stay is saved.",
  "trips.stay.documentsAfterSave": "You can add documents once this stay is saved.",
  "trips.gallery.title": "Image gallery",
  "trips.gallery.uploadAction": "Upload",
  "trips.gallery.moveUp": "Up",
  "trips.gallery.moveDown": "Down",
  "trips.gallery.selectedFiles": "{count} file(s) selected",
  "trips.gallery.empty": "No images yet.",
  // Dialog photo previews are meaning-bearing, not decorative (DESIGN.md.Photo Alt-Text), and each
  // remove button needs a name unique within its dialog — hence the index rather than a shared string.
  "trips.gallery.imageAlt": "Image {index} of {total}",
  "trips.gallery.removeImage": "Remove image {index} of {total}",
  "trips.gallery.uploadZoneTitle": "Choose photos",
  // Story 6.12: the shared fullscreen viewer and the two thumbnail strips that open it. The position
  // line inside the viewer reuses `trips.gallery.imageAlt` rather than restating "{index} of {total}".
  // This one is read aloud rather than seen — it is the `+N` control's only accessible name — so it
  // takes the codebase's singular-twin treatment rather than a written-out "(s)" a screen reader
  // would spell out. `formatMessage` has no plural support.
  "trips.gallery.showMoreImages": "Show {count} more photos",
  "trips.gallery.showMoreImagesOne": "Show 1 more photo",
  "trips.gallery.viewer.title": "Photo viewer",
  "trips.gallery.viewer.close": "Close photo viewer",
  "trips.gallery.viewer.previous": "Previous photo",
  "trips.gallery.viewer.next": "Next photo",
  // Story 9.1 — documents on stays and activities. A namespace of its own, sitting beside
  // `trips.gallery.*` because the two are the same gesture on the same tab, and separate from it
  // because they are not the same thing: a photo is one of the trip's photographs and a document is a
  // ticket or a booking confirmation. Story 6.26 Task 5 rules on this — two surfaces that group
  // different things get their own keys, even where the English happens to coincide with the
  // gallery's (`uploadAction`, `selectedFiles`) or with `trips.image.unsupportedFormat`. Sharing them
  // would mean one wording change to the photo field silently rewording the document field, and it is
  // AC2's "visibly distinct label" that would be lost first.
  "trips.documents.title": "Documents",
  "trips.documents.uploadZoneTitle": "Choose documents",
  // States both ceilings the routes enforce, because a rejected 12 MB upload is a worse way to learn
  // the limit than reading it. Wired to the file input as `aria-describedby`, never sighted-only.
  "trips.documents.uploadZoneHint": "PDF, JPEG, PNG or WebP, up to 10 MB each",
  "trips.documents.selectedFiles": "{count} file(s) selected",
  "trips.documents.empty": "No documents yet.",
  "trips.documents.uploadAction": "Upload",
  "trips.documents.removeDocument": "Remove document {index} of {total}",
  // The chip's accessible name. Two documents on one entry may share a file name — the unique index
  // is on `sortOrder`, not on the name — so the position is part of the name rather than decoration:
  // without it a card with two "Ticket.pdf" chips offers a screen-reader user two identical links,
  // which is the defect Story 5.11's review found on two comboboxes. The *visible* label stays the
  // bare name; this string is what `aria-label` overrides it with.
  "trips.documents.openDocument": "Open {name} ({index} of {total})",
  // The `+N` control's only accessible name, read aloud rather than seen, so it takes the codebase's
  // singular-twin treatment rather than a written-out "(s)" a screen reader would spell out.
  // `formatMessage` has no plural support — see the note on `trips.gallery.showMoreImages`.
  "trips.documents.showMoreDocuments": "Show {count} more documents",
  "trips.documents.showMoreDocumentsOne": "Show 1 more document",
  "trips.documents.overflowTitle": "All documents",
  "trips.documents.unsupportedFormat": "Unsupported document format. Please choose a PDF, JPEG, PNG, or WebP file.",
  "trips.documents.limitReached": "Up to 10 documents per entry.",
  "trips.documents.uploadError": "Document upload failed. Please try again.",
  "trips.documents.deleteError": "Document removal failed. Please try again.",
  // Story 9.2's day-menu entry and its three outcomes. "Packet" rather than "PDF" because what the
  // traveller gets is one file containing the day's tickets, and naming the format says nothing about
  // that; the printed sheet's appendix uses the same word to point here.
  "trips.documents.packetAction": "Download document packet",
  "trips.documents.packetPending": "Building packet…",
  "trips.documents.packetTooMany": "This day has too many documents for one packet. Remove a few and try again.",
  // Deliberately not `trips.detail.notFoundBody`, which the route's own `no_documents` code exists to
  // keep this case away from: a traveller told the trip does not exist, when the day simply has no
  // tickets on it, goes looking in the wrong place.
  "trips.documents.packetEmpty": "This day has no documents to package.",
  "trips.documents.packetError": "Document packet could not be created. Please try again.",
  "trips.location.latLabel": "Latitude",
  "trips.location.lngLabel": "Longitude",
  "trips.location.searchLabel": "Search place",
  // Story 6.28 AC3. The helper on all five place fields, and the only place the separator rule can be
  // stated before it is needed. It names the latitude-first order because the parser deliberately does
  // not guess at a swapped pair (two valid latitudes are indistinguishable), and it shows both accepted
  // spellings — the dot form and the German comma form with a semicolon between the halves.
  //
  // The trip-create form's own helper key ("Search and select a place") was deleted in favour of this
  // one: it said less, on two of the same five fields. See `i18nDictionaries.test.ts` for the full list
  // of seven keys Story 6.28 removed and why each went.
  "trips.location.searchHelper": "Place name, or coordinates — latitude first: 48.8584, 2.2945 (or 48,8584; 2,2945)",
  "trips.location.searchAction": "Find",
  "trips.location.clearAction": "Clear",
  // Story 6.28 review. This said "Enter a place name to search" on a field that, one row below, states in
  // its own helper text that it also takes coordinates and a Maps link — the empty-field message must not
  // contradict the helper it sits under. `searchLabel` above is deliberately untouched: "Search place" is
  // still what the box does, and several suites resolve their controls through it.
  "trips.location.searchRequired": "Enter a place name, coordinates or a Maps link",
  "trips.location.lookupError": "Location lookup failed. Please try again.",
  "trips.location.noResult": "No matching place found",
  "trips.location.noCoordinates": "No coordinates selected",
  // Story 6.28 AC3's refusal. It names what to type instead rather than only saying "invalid": the input
  // that reaches this message is `48,8584,2,2945`, which has two readings and no way to choose, so the
  // only useful answer is the spelling that has one.
  "trips.location.coordinatesAmbiguous": "Coordinates unclear. Write 48.8584, 2.2945 or 48,8584; 2,2945.",
  // Story 6.28 AC5. `{count}` because a heading over a list of choices has to say how many there are;
  // `formatMessage` has no plural support, and this string is grammatical for every count.
  "trips.location.resultsLabel": "Select a place ({count})",
  // The bucket list's submit path only. It geocodes silently when the user typed a place and never
  // pressed Find, and with several candidates it cannot prompt mid-save — so it stops and asks.
  "trips.location.selectRequired": "Select one of the places found.",
  // Already worded for AC4 before this story existed, and reused as-is: `parseLocationInput` checks the
  // latitude first, so exactly one of the two is ever shown.
  "trips.location.latInvalid": "Latitude must be between -90 and 90",
  "trips.location.lngInvalid": "Longitude must be between -180 and 180",
  // Story 5.8. A `users.` namespace of its own rather than a `trips.` sub-key: the surface is not
  // scoped to a trip, and reading it under `trips.` would suggest it is.
  "users.registered.title": "Registered users",
  "users.registered.subtitle": "Every account in TravelPlan",
  "users.registered.countLabel": "Accounts ({count})",
  "users.registered.empty": "No accounts registered yet.",
  "users.registered.loadError": "Unable to load registered users. Please refresh.",
  "users.registered.forbidden": "Only trip owners can view registered users.",
  // Story 5.10. An `admin.` namespace rather than more `users.registered.*`, because the two surfaces are
  // deliberately kept apart: `/users` stays the read-only list Story 5.8 built for trip owners deciding
  // whom to invite, and this is the administration of accounts, behind `ADMIN`. Sharing a key prefix would
  // invite the next reader to share a component.
  "admin.users.title": "User administration",
  "admin.users.subtitle": "Every account, and what each one can reach",
  "admin.users.countLabel": "Accounts ({count})",
  "admin.users.empty": "No accounts registered yet.",
  "admin.users.loadError": "Unable to load accounts. Please refresh.",
  "admin.users.forbidden": "Only administrators can manage accounts.",
  // AC3's vocabulary, and the two words the whole surface turns on. "Owns" is `Trip.userId`; "Shared" is a
  // `TripMember` row. They are two different relations and must not collapse into one word - only the
  // first blocks a deletion, and only the second can be detached.
  "admin.users.ownsLabel": "Owns",
  // Renamed from `reachesNothing` in review of 5.11, and re-worded with it. That key answered for
  // BOTH relations ("No trips") and was rendered only when both were empty — which, once the shares
  // section started always speaking for itself, made such an account say so twice in two nouns. This
  // one answers for ownership alone, so it has to name ownership.
  "admin.users.ownsNothing": "Owns no trips",
  "admin.users.youBadge": "You",
  "admin.users.adminBadge": "Admin",
  "admin.users.roleVIEWER": "Viewer",
  "admin.users.roleCONTRIBUTOR": "Contributor",
  // Create
  "admin.users.create.action": "Add account",
  "admin.users.create.title": "Add account",
  "admin.users.create.emailLabel": "Email",
  "admin.users.create.passwordLabel": "Temporary password",
  "admin.users.create.passwordHelper": "The account must change it on first sign-in.",
  "admin.users.create.submit": "OK",
  "admin.users.create.error": "Unable to create the account.",
  "admin.users.create.emailExists": "An account already exists for this email.",
  // The two rules the server enforces, said in the field rather than left to a red box with no words.
  // `passwordRule` covers both ends because `passwordSchema` is 8-72 and a caller who trips either needs
  // the same sentence.
  "admin.users.create.emailRequired": "An email address is required.",
  "admin.users.create.passwordRule": "Between 8 and 72 characters.",
  // The server's `validation_error`, which is reachable even with the client rules above - a malformed
  // address the browser accepts and `normalizedEmailSchema` does not, for one.
  "admin.users.create.validationError": "Check the email address and the password, then try again.",
  // Grant and revoke (AC8a)
  "admin.users.grantAdmin": "Make administrator",
  "admin.users.revokeAdmin": "Remove administrator",
  "admin.users.roleError": "Unable to change the role.",
  "admin.users.lastAdmin": "At least one administrator must remain.",
  // Attach and detach (AC5, AC6)
  "admin.users.attach.action": "Add to trip",
  "admin.users.attach.title": "Add {email} to a trip",
  "admin.users.attach.tripLabel": "Trip",
  "admin.users.attach.roleLabel": "Role",
  "admin.users.attach.submit": "OK",
  "admin.users.attach.noTrips": "There are no trips to add anybody to yet.",
  "admin.users.attach.error": "Unable to update the membership.",
  "admin.users.attach.tripOwner": "This account already owns that trip.",
  // The routes return `not_found` and `trip_not_found` as two codes deliberately, because which of the two
  // is gone is the difference between reloading the list and picking another trip. Two strings, so the
  // distinction survives to the person who has to act on it.
  "admin.users.attach.tripNotFound": "That trip no longer exists. Reload the list.",
  "admin.users.attach.userNotFound": "That account no longer exists. Reload the list.",
  // Marks a trip the account is already a member of, so the picker cannot change a role without saying
  // which role it is changing.
  "admin.users.attach.currentRole": "currently {role}",
  // The accessible name, which has to name the trip: a row with two memberships otherwise renders two
  // buttons with identical names, indistinguishable to a screen reader and to `getByRole`.
  //
  // Story 5.11: `detach.action` ("Remove from trip") was this control's *visible* label as a text button.
  // It is a trash glyph now, so this key is both its accessible name and its tooltip, and the visible
  // label has no reader left - deleted from both dictionaries rather than kept for a control that is gone.
  "admin.users.detach.actionFor": "Remove {email} from {trip}",
  "admin.users.detach.error": "Unable to remove the membership.",
  "admin.users.detach.notFound": "That membership no longer exists. Reload the list.",
  // Story 5.11. Removing a share is confirmed now - see the component for why that reverses the earlier
  // reversibility argument. The safe half names what it preserves in the same noun as its neighbour
  // (Story 6.25 AC3), so "Keep share" beside "Remove share".
  "admin.users.detach.confirmTitle": "Remove share",
  "admin.users.detach.confirmBody": "{email} loses access to {trip}. The trip itself is unchanged.",
  "admin.users.detach.confirm": "Remove share",
  "admin.users.detach.keep": "Keep share",
  // Story 5.11. The row's overflow trigger. Named per account for exactly the reason `detach.actionFor`
  // is: a list renders one per row, and three controls called "More actions" cannot be told apart.
  "admin.users.rowMenuFor": "More actions for {email}",
  // The shares section under each account. A different word from `sharedLabel` ("Shared with") on
  // purpose: that one prefixes a relation, this one titles a table.
  "admin.users.sharesLabel": "Shares",
  "admin.users.sharesEmpty": "No shares",
  "admin.users.sharesTripColumn": "Trip",
  "admin.users.sharesRoleColumn": "Role",
  // The trash column has no visible header - the glyphs name themselves - but the column still needs one
  // for anyone reading the table by its structure.
  "admin.users.sharesActionColumn": "Action",
  // Names the per-row select. The column header alone would name every select on the page "Role".
  // AC7, restored in review: the account belongs in this name. `roleToggleFor` carried it, this key
  // replaced that one and named only the trip, and two accounts sharing one trip then rendered two
  // comboboxes with the same accessible name — the exact defect 5.10's review added the email for.
  "admin.users.roleForTrip": "Role for {trip} ({email})",
  // The table's own accessible name. The visible label stays the bare word for sighted readers; this
  // names which account's shares the table holds, because one page renders one table per account.
  "admin.users.sharesLabelFor": "Shares of {email}",
  // Delete (AC7). The safe half names what it preserves, per Story 6.25 AC3, and in the same noun as its
  // neighbour: "Keep account" beside "Delete account".
  "admin.users.delete.action": "Delete account",
  "admin.users.delete.title": "Delete account",
  // Says what deletion actually does, which the first wording did not: the account goes and its *access* to
  // trips shared with it goes, but those trips belong to somebody else and are untouched. The earlier
  // "along with every trip shared with them" read as though the trips were deleted too - the exact cascade
  // AC7's refusal exists to prevent, described in the one dialog where the fear of it lives, and by
  // collapsing ownership and membership into a single word that AC3 keeps apart everywhere else. The second
  // sentence is why an account owning trips never reaches this dialog at all.
  "admin.users.delete.body":
    "{email} loses its access to any trip shared with it. The trips themselves are not deleted — they belong to their owners. An account that owns trips cannot be deleted. This cannot be undone.",
  "admin.users.delete.confirm": "Delete account",
  "admin.users.delete.keep": "Keep account",
  "admin.users.delete.error": "Unable to delete the account.",
  // AC7's refusal, in the admin's own words. The trips are named rather than counted, because the point of
  // the message is that the admin can see what is in the way without going to look.
  "admin.users.delete.ownsTrips": "{email} owns these trips and cannot be deleted: {trips}",
  "admin.users.delete.selfDelete": "You cannot delete your own account here.",
  // Story 6.17 removed `common.save`. It was named as though it were shared and had exactly one
  // reader — the travel-segment dialog — whose button now says "OK". That value lives on
  // `trips.travelSegment.save` instead, so the next dialog needing a save button adds its own key
  // rather than inheriting an OK button from a `common.` name.
  //
  // Story 6.25 removed `common.cancel` for the opposite reason: it had eleven readers and every one
  // of them stopped needing it. Ten were form dialogs whose dismissal became the title-row `✕`; the
  // last two were destructive confirmations, where "Cancel" was the wrong word rather than a
  // redundant one — those now say what they keep ("Keep trip", "Keep entry"). A key with no readers
  // left is the `common.save` shape again, so it is deleted rather than left waiting to be picked up.
  "common.close": "Close",
  // Story 6.25 AC7. A `common.` name with **ten** readers, which is what the 6.17 note was actually
  // about: the trap is a shared-sounding name with one reader, not a shared name for a shared thing.
  // Every form dialog in the app asks this same question in these same three words when a `✕` would
  // otherwise throw typing away. Only the body varies, and that one stays per-dialog.
  "common.discard.title": "Discard changes?",
  "common.discard.body": "Your changes will be discarded.",
  "common.discard.confirm": "Discard changes",
  "common.discard.keep": "Keep editing"
};

export default en;
