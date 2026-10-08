# Privacy Policy

This policy explains what personal data Bloombroke collects, why, who receives it, how long we keep it and what you can ask us to do. We follow Singapore's Personal Data Protection Act 2012 (the "PDPA").

## 1. Who we are

{{OPERATOR}} ("we", "us") runs bloombroke.com. We decide how your personal data is used.

Our Data Protection Officer can be reached at {{CONTACT}}. Write to this address for any question, request or complaint about your personal data.

## 2. The short version

- You can use the free terminal without an account, a name or an email address.
- Your watchlist, portfolio, saved wage, command history and screen layouts are stored in your own browser, not on our servers, unless you turn on Pro sync.
- We count visits with DataFast and Google Analytics; Ahrefs Web Analytics and Cloudflare count page views without cookies. If your browser sends Global Privacy Control, we load none of DataFast, Google Analytics and Ahrefs Web Analytics.
- Sponsor links carry no tracking codes, and sponsors get no data from us.
- Pro payments go through Stripe. We never see your full card number.
- CHAT messages between Pro members are seen only by the people in that chat, unless a chat is reported, and are deleted after 30 days.
- In ME you can download your data and delete your account yourself, at any time, as well as by writing to us.
- We do not use your data to train AI models, we do not sell it, and we send no marketing messages except the one email you ask for under "Pro opens soon." on the PRO screen, and the one email you ask for on the build guide page.
- If you leave your email address under "Pro opens soon." on the PRO screen, we send it one email when Pro opens, and nothing else.
- If you save a card for a founders seat, Stripe holds the card. We keep your email address, your seat and the facts we need to charge it only when the goal is reached, or to delete it.

## 3. What we collect and why

### Using the free terminal

- **Requests to our server.** When you open a screen, your browser asks our server for data, such as the symbols on your watchlist. Our server passes the symbols to the data source and sends back the result. We use these requests only to answer them. When you open a ticker screen, your browser sends its symbol and a random number made for that browser tab. To count each tab once and to stop abuse, our server keeps a coded copy of that number and of your IP address, with the tickers opened, in memory for one hour, then only the count per ticker for 24 hours. Nothing is written to disk. Apart from this count, we do not keep a record of which symbols a person asked for.
- **Your IP address.** Every connection reveals your IP address. Our network provider, Cloudflare, uses it to deliver the site and block attacks. Our application does not write IP addresses to its logs. To stop abuse and the guessing of licence keys and gift codes, it limits how often each visitor can use the Pro routes and gift codes (a 10 or 15 minute window), the share images and the WHATIF results kept for them (a 10 minute window), the ticker counter, the site counters, the GUESS game and the pay respects button on GRAVEYARD stones (a one minute window), the feedback form and the Pro waitlist (a one hour window), and the MCP endpoint (a one minute, a 10 minute and a 24 hour window). It limits the founders seats and tips checkouts the same way (a one hour window), and the founders page's check of a finished checkout (a 10 minute window). For this it holds your IP address in memory, or for the ticker counter a coded copy of it, for the length of the window, and forgets it within one minute after the window ends. The one place we store an IP address is a founders seat: the address that started its checkout, kept with that seat as "Founders seats" below says.
- **The MCP endpoint.** When an AI app such as Claude, ChatGPT, Grok or Cursor calls our MCP endpoint (bloombroke.com/mcp) for you, our server answers the request and counts it per tool. The count has no IP address and nothing of what was asked. We do not store the inputs a tool is called with: our logs keep only the tool name and whether the call worked. Your IP address is held only in its rate limiter, for the windows given under "Your IP address" above and in section 8. What you type into the AI app is covered by that app's own privacy policy.
- **Pay respects.** On a GRAVEYARD stone, pay respects (the F key or its button) adds one to a total for that stone. The totals are aggregate counts per stone, with no IP address and nothing about who paid them. Your IP address is held only in the rate limiter, for the one minute window above. So that each stone gets at most one respect from you a day, our server also keeps a coded copy (a salted hash) of your IP address and the stone in memory until the end of that New York day, with a new salt each day, and never writes it to disk.
- **Videos on GRAVEYARD stones.** A stone page shows our own drawing in place of a video, and nothing is loaded from YouTube or Google until you press play. When you press play on a GRAVEYARD video, the video is loaded from YouTube (Google) in its privacy-enhanced mode (youtube-nocookie.com), and Google receives your IP address and device data under its own privacy policy.
- **Error logs.** When something breaks, our server writes an error message to its logs. These messages do not contain your IP address, and we aim to delete them within 14 days.
- **Your browser storage.** The terminal saves some things in your browser's local storage so they are there next time: your watchlist, portfolio, saved wage, recent commands, screen layouts, your acceptance of these terms (with its version and time), the settings you choose in ME for this device (start screen, clock, chat sound) and, for Pro, your licence key. This data stays on your device. We cannot see it unless you use Pro sync. You can delete it at any time by clearing this site's data in your browser.

### Analytics

We use DataFast (datafa.st) to understand how many people visit and which screens they use. The DataFast script sets two first-party cookies: datafast_visitor_id, which lasts about one year, and datafast_session_id, which lasts about 30 minutes. It sends DataFast the page address, the referring page, your browser, operating system, device type, screen size, language and time zone, and it records clicks on links that lead to other sites. DataFast uses your IP address to work out your approximate location, such as your country and city. We use this only as totals and trends, and we do not use it to identify you.

- **Global Privacy Control.** If your browser sends a Global Privacy Control (GPC) signal, we do not load DataFast on any page of bloombroke.com.
- **Feature events.** When you use certain features, such as a WHATIF result or a GUESS game, we send DataFast an event with the feature's name and, for some features, a short fixed label, such as how a result was shared. The event itself carries no personal data, but DataFast links it to the same visitor and session cookies as your visits.
- **Ahrefs Web Analytics.** We also count page views with Ahrefs Web Analytics (analytics.ahrefs.com). It sets no cookies. It records the pages viewed, the referring page, your approximate country, and your device and browser type. Like DataFast, it is not loaded when your browser sends GPC, and it is never loaded for Pro users.
- **Google Analytics.** We also count visits with Google Analytics, a service of Google. It sets first-party cookies named _ga and _ga_ followed by a code, which last up to two years, so that it can tell a returning browser from a new one. It records which screens you open, the referring site, your browser, device type, screen size and language, and the same feature events we send DataFast, plus one share event when you copy or share a link or image. For each screen it gets only the command's name and, for stock, chart, WHATIF and GRAVEYARD screens, the ticker or item and range, and campaign tags from the link you arrived on; never anything else you type, such as keys, gift codes, amounts, messages, usernames or email addresses. Google uses your IP address to work out your approximate location, such as your country and city. We have turned Google Signals and ad personalisation off, so this data is not linked to Google accounts and is not used for ads. Google Analytics runs for free visitors only: it starts only after you accept on the first-visit card, it is never loaded for Pro users, and it is not loaded when your browser sends GPC.
- **Cloudflare Web Analytics.** Cloudflare, our network provider, adds its own count of page views and page load times. Cloudflare states that it does not use cookies for this and does not identify visitors. It is not affected by GPC.
- **Our own counters.** Our server keeps daily totals of some actions, such as WHATIF results, GUESS games, feedback notes, MCP tool calls, and how many times sponsor-strip lines were shown and clicked. These are totals only, with no IP address and nothing about who did what, so we keep them even when your browser sends GPC.
- **What we publish.** We publish aggregate visitor numbers on our BBRK screen, including visitor counts by country, from DataFast totals; a country or referring site with fewer than three visitors is not shown on its own, and we publish approximate locations: country totals, and city dots rounded to about 100 km, only for places with three or more visitors in the last seven days; never anything about a single visitor.

### Pro subscribers

If you subscribe to Pro, we also process:

- **Your licence record.** A one-way hash of your licence key and its last four characters (never the key in plain text), your Stripe customer ID, subscription ID and checkout session ID, your subscription status and its dates, whether you pay monthly or yearly, your seat number, and the time you accepted the Terms at checkout. We show your seat number to you on your own screen. For 24 hours after checkout we also keep an encrypted copy of your key so the success page can show it to you; after that it is deleted.
- **Synced data.** If you use sync, the watchlist, portfolio, ticker tape, DESK layouts and your ME device settings in your browser are stored on our server, linked to your licence, so they can appear on your other devices.
- **ME.** If you choose them in ME, we store your username, your name colour (one of 8) and your pixel avatar (an 8x8 picture you draw, stored as 16 characters), with your licence. The people you chat with see them. When you change or clear your username, or delete your account, we keep the old name for 30 days so that nobody else can take it at once, with which licence gave it up (until the account is deleted), and then delete it. We also count how many times your username changed in the last day, to keep to 3.
- **NEW KEY.** NEW KEY in ME gives your licence a new key. We replace the stored hash and last four characters with the new key's, and the old key stops working at once. Nothing else changes.
- **DOWNLOAD MY DATA.** In ME you can download, as one JSON file, your seat, username, colour and avatar, your plan and its dates, your synced data, your chat contacts, blocks and chats (other people only as seat and username), the messages you sent that still exist, your GUESS results in chats and the state of the gift codes you made. It never holds your key, its hash or any Stripe ID.
- **DELETE MY ACCOUNT.** In ME you can delete your account once no subscription on it will renew. We then delete your username (it stays locked for 30 days, and nobody can take it back), colour, avatar, synced data including your settings, your CHAT membership, the messages and chat requests you sent (except copies inside reports others made, kept as section 8 says), your blocks, the reports you made, your GUESS results and your unused gift codes, and we make your key unusable. We keep the licence record (seat number, Stripe IDs and dates) for the 5 years in section 8, for payment and refund records.
- **Payment data.** Stripe collects your name, email address, billing address and card details. Stripe tells us your email address, name, billing country, the brand and last four digits of your card and your payment history, which we use to run your subscription, send receipts and deal with problems. We do not receive your full card number.

### Gift codes

- **Making a code.** If you make a gift code, we store a one-way hash of the code and its last four characters (never the code in plain text), which licence made it, when it was made and when it expires, and, once it is used, when it was used and which licence it made.
- **Redeeming a code.** If you redeem a gift code, we make a licence record for you with a one-way hash of your new key and its last four characters, your seat number and the date your gift month ends. It has no Stripe IDs and no payment data, and we do not ask for your name or email address.

### Sponsors

When sponsors run, sponsor lines rotate in the status line, and each is marked SPONSOR and is one plain line of text with a plain link; a WEIRD gauge may show the name of its sponsor. We add no tracking code to the link, we load no sponsor pixels or scripts, and sponsors get no data from us. Our analytics tool, DataFast, counts link clicks, including clicks on sponsor links, as part of its normal site analytics described above, and Google Analytics counts clicks on sponsor links as a feature event. We also count, in total, how many times sponsor-strip lines were shown and clicked; nothing is kept per person. The link asks your browser not to tell the sponsor which page you came from. If you click it, the sponsor's own site and its privacy policy apply.

### Feedback

If you send feedback with the FEEDBACK command, we store your message, your email address if you give one, the screen you were on before FEEDBACK, the time, and which version of our terms was current. We use it to improve the service, and your email address only to reply to you. We do not store your IP address with it. We keep feedback for up to 12 months, then delete it.

### Pro waitlist

While Pro is not open to new subscribers, the PRO screen shows "Pro opens soon." and lets you leave your email address. We store your email address and the time you gave it. We use it only to send you one email when Pro opens, and we send nothing else to it. We do not store your IP address with it, and our analytics tools get only a note that someone joined the list, never your email address. To be taken off the list, write to {{CONTACT}}. We delete the whole list once that email has been sent, and your address sooner if you ask.

### Founders seats

If you save a card for a founders seat on the founders page, Stripe collects your card details, email address and name, and holds your card. We do not receive your full card number. We store your seat number and class, your email address, the X handle if you give one, your Stripe customer ID, the IDs of the saved card and of its setup, the card's fingerprint (a code Stripe gives each card number; it is not the card number), the time you agreed to the charge terms, which version of these terms you agreed to, and the IP address that started the checkout. We use them to keep to one seat per person, to charge the seat when the goal is reached, to delete the card and your customer record at Stripe if the goal is missed, you give up the seat or the checkout did not give you a seat, and to answer you. While a checkout is open we hold the seat for about 30 minutes with that IP address; if the checkout is not finished, the address is deleted. The founders page shows each taken seat's number and, if you gave one, your handle, and a line with no name when a seat is released. Nothing else about you is shown.

### Tips

If you tip on the founders page, Stripe processes the payment and collects your card details, email address and name. We store the amount, the fish name you typed, whether it was approved, and the time. We do not store your email address or name with it. The FISHTANK shows the approved fish name for 365 days, never who gave the tip.

### Build guide list

If you leave your email address on the build guide page (bloombroke.com/guide), we store it and the time you gave it, on a list kept apart from the Pro waitlist. We use it only to send you one email when the guide is ready, and we send nothing else to it. We do not store your IP address with it. To be taken off the list, write to {{CONTACT}}. We delete the whole list once that email has been sent, and your address sooner if you ask.

### CHAT

If you use CHAT, a Pro feature, we store your seat number, the username, colour and avatar you choose in ME, which seats you asked to chat with and who asked you, who you chat with and who you blocked, the groups you are in, and your messages with the time they were sent. When a message names a $TICKER, we also store that ticker's price at the moment you sent it, so the chat can show the move since. A message is shown only to the people in that chat. We do not read messages or use them for anything else: our server only checks each one for links, which are not allowed, and for $TICKERs. The exception is a report: when you or someone else reports a chat, we store a copy of the last 20 messages of that chat, who reported it, the seats in it and the reason given, and we read that copy to deal with the report. We keep messages for 30 days, then delete them. If you post a GUESS result to a chat, we store its score with the message, and the lines CHAT posts itself (who went live or ended live, last week's GUESS winner) are stored like messages; all of them are deleted after 30 days. With GO LIVE, the screens you open are shown live to the people who WATCH you: the server keeps only your current screen, in memory, while you are live, and stores none of them.

### Pings

If you turn on pings in ME, a Pro feature, your browser gives us a push subscription for that device: an address at the push service of your browser's maker (Apple, Google, Mozilla or Microsoft) and the keys that encrypt a ping for that browser only. We store the subscription for each device, your ping settings (chat messages, alerts when the tab is closed, show message text), and, for each device that has alerts when the tab is closed on, a copy of that device's price alert rules (symbol, above or below, level, and whether each one has fired) so that our server can check them with the tab closed and ping that device. A ping goes from our server through that push service to your device, and its content is encrypted end to end: the push service delivers it but cannot read it. A chat ping names who wrote; it includes the start of the message text only if you turn on SHOW MESSAGE TEXT. You can turn pings off in ME at any time.

### When you contact us

If you email us, we receive your email address and whatever you write, and we use them to reply and keep a record of the conversation.

## 4. Purposes

We use personal data only to:

- provide the service and show you the data you ask for;
- run Pro: take payments, give access, sync your data, carry CHAT messages and handle cancellations and refunds;
- deal with reports about CHAT messages;
- send you the pings you turn on in ME;
- send the one email when Pro opens to the people who asked for it on the PRO screen;
- run founders seats: hold the saved cards, charge them when the goal is reached, or delete them; and take tips and show tip fish;
- send the one email when the build guide is ready to the people who asked for it on the build guide page;
- keep the service secure, prevent abuse and fraud, and enforce our [Terms of Use](/terms);
- understand how the service is used, in totals, so we can improve it;
- answer your messages and requests, and read your feedback;
- meet our legal, tax and accounting duties.

## 5. Consent

By using Bloombroke, and by clicking ACCEPT on the first-visit notice, you consent to us collecting, using and disclosing your personal data as this policy describes. Where the PDPA lets us process data without consent, for example to meet a legal duty, we may rely on that instead.

You can withdraw your consent at any time by writing to {{CONTACT}}. We will tell you what withdrawing means for you. For example, we cannot provide Pro without your licence record and payment data, so withdrawing consent for those means ending your subscription. You can also stop DataFast and Google Analytics by turning on Global Privacy Control in your browser, or by blocking cookies or scripts from datafa.st and googletagmanager.com; the terminal keeps working.

## 6. Who receives your data

We share personal data only with these service providers, which help us run Bloombroke, and only what each one needs:

| Provider | What it does for us | Where |
|---|---|---|
| Stripe | Pro payments and billing, founders seats (saved cards) and tips | United States and Ireland, among other places |
| Cloudflare | Network, security and delivery for every visit, DNS, page-view counts (Cloudflare Web Analytics), and routing of email sent to {{CONTACT}} | A global network, based in the United States |
| DataFast | Visit analytics, as described in section 3 (not loaded when your browser sends GPC) | Mostly outside the EU, including the United States, as its data processing terms state |
| Ahrefs | Page-view analytics (Ahrefs Web Analytics), as described in section 3: no cookies, not loaded when your browser sends GPC, never loaded for Pro users | Based in Singapore; its servers may be in other countries, as its own terms state |
| Google (Google Analytics) | Visit analytics, as described in section 3: first-party cookies, Google Signals and ad personalisation off, not loaded when your browser sends GPC, never loaded for Pro users | United States, among other places |
| Hetzner | Hosting: the server that runs Bloombroke and stores Pro data | Ashburn, Virginia, United States |
| Google (Gmail) | The mailbox that receives email sent to {{CONTACT}} | United States, among other places |
| Apple, Google, Mozilla, Microsoft (push services) | Only if you turn on pings: the push service of your browser's maker delivers each ping, encrypted end to end, to your device | Their own networks, mainly in the United States |

We may also disclose personal data when the law requires it, to a regulator or court, to protect our rights or someone's safety, or to a buyer if the service is sold, in which case this policy continues to apply.

We do not sell personal data. We do not share it with advertisers or data brokers. We share nothing about you with sponsors. We do not use your data to train AI models.

## 7. Transfers outside Singapore

Our server and several providers are outside Singapore, so your personal data is transferred to and stored in other countries, including the United States. When we transfer personal data out of Singapore, we take steps required by the PDPA so that it keeps a standard of protection comparable to the PDPA, for example through the providers' data processing terms and the safeguards they commit to.

## 8. How long we keep it

| Data | How long |
|---|---|
| IP addresses in our rate limiters | For the length of the limit window (one minute for the ticker counter, the site counters, GUESS and pay respects; 10 or 15 minutes for the Pro routes and gift codes; 10 minutes for share images; one hour for feedback, the Pro waitlist and moving a ping subscription; one minute, 10 minutes and 24 hours for the MCP endpoint), plus at most one minute. Held in memory, never on disk. The pay respects once-a-day check keeps a salted hash of your IP address and the stone until the end of that New York day, in memory, never on disk. |
| Ticker counter | A coded copy of your browser tab's random number and of your IP address, with the tickers opened, for one hour; after that only the count per ticker, for 24 hours. All in memory, never on disk. |
| Error logs on our server | We aim to delete them within 14 days. |
| Records kept by Cloudflare, DataFast, Ahrefs and Google | For the periods in their own policies. |
| Pro licence record | The hash and last four characters of your key, your seat number, your Stripe IDs and the dates are kept while your licence exists and for 5 years after your subscription is cancelled, for payment and refund records, and then deleted. A licence whose subscription is unpaid or overdue is kept until the subscription is cancelled. If you delete your account in ME, the record stays for the same time, with a key that no longer works. |
| Synced data | Deleted 30 days after your subscription ends, or sooner if you ask. |
| Encrypted copy of your key | Deleted as soon as your browser has saved the key, and at the latest 25 hours after checkout. |
| Payment records | Records of payments that tax and company law require us to keep, such as invoices, are kept for as long as that law requires, normally five years, and are held mainly in Stripe. |
| Gift licences | The licence record is kept for 5 years after the gift month ends, and then deleted. Synced data is deleted 30 days after the gift month ends. |
| Gift code records | Deleted 12 months after the code was used or expired. Your licence record keeps only a count of the redeemed codes that were deleted, so the limit of 3 still applies. |
| Feedback | Up to 12 months, then deleted. |
| Pro waitlist | Until the email that Pro is open has been sent, then the whole list is deleted. Your address sooner if you ask. |
| Founders seats | If the goal is missed, or you give up your seat, we delete the card and your customer record at Stripe and clear the seat's email address, handle, Stripe IDs, card fingerprint and IP address. A charged seat is kept like a Pro licence record: for 5 years after the seat ends, then deleted. |
| Tips | The tip record (amount, fish name, time) is kept as a payment record, normally five years. The fish is shown for 365 days. |
| Build guide list | Until the email that the guide is ready has been sent, then the whole list is deleted. Your address sooner if you ask. |
| Chat messages | Deleted 30 days after they were sent. Chat requests are deleted after 30 days too. |
| Chat reports | Up to 12 months, then deleted. |
| Chat contacts and blocks | Deleted 30 days after your Pro ends, at once when you delete your account in ME, or sooner if you ask. |
| Username, colour and avatar | Deleted 30 days after your Pro ends, at once when you delete your account in ME, or sooner if you ask. |
| A username you gave up | Kept 30 days so nobody else takes it at once, then deleted. |
| Ping subscriptions | Each device's push subscription is kept until you turn pings off on that device, log out on it, make a NEW KEY or delete your account, or 30 days after your Pro ends, whichever comes first. A subscription the push service says is gone, or that fails 5 times in a row, is deleted at once. |
| Ping settings and server alerts | Your ping settings are kept until you delete your account, or 30 days after your Pro ends. The copy of a device's price alert rules is kept only while alerts when the tab is closed are on for that device, is replaced each time you change the alerts there, and is deleted with that device's subscription. |
| ME device settings | In your browser until you clear it. For Pro, the synced copy follows the synced data rule above, and goes at once when you delete your account in ME. |
| Emails | For as long as we need them to deal with your message, and then deleted, unless we need to keep them for a legal reason. |
| Our own counters | Daily totals only. They contain no personal data. |
| Your browser storage | Until you clear it. We have no control over it. |

## 9. Your rights

You may ask us:

- for a copy of the personal data we hold about you, and how it has been used or disclosed in the past year;
- to correct personal data that is wrong or incomplete;
- to delete your Pro data before the end of the 30-day period.

You can also do the first and the last yourself in ME: DOWNLOAD MY DATA gives you a copy of what we hold about you, and DELETE MY ACCOUNT deletes it, as section 3 describes.

Write to {{CONTACT}}. We may need to check that you are who you say you are, for example by asking you to prove you hold the licence key. We will reply within 30 days, or tell you within that time when we will reply. We may charge a reasonable fee for a copy of your data, and we will tell you the fee first. There are some cases where the PDPA lets us refuse a request, and we will explain if that happens.

## 10. How we protect it

We keep only what we need. Licence keys are stored as one-way hashes, connections are encrypted with HTTPS, and access to our server is restricted. No system is perfectly secure, so we cannot promise that data will never be lost or accessed without permission.

If a data breach happens, we will assess it quickly. If it is a notifiable data breach under the PDPA, we will notify the Personal Data Protection Commission within the time the law sets, and notify the people affected where the law requires it.

## 11. Children

Bloombroke is not for anyone under 18. We do not knowingly collect personal data from anyone under 18. If we learn that we have, we will delete it.

## 12. Changes to this policy

We may change this policy. The version number and date at the top of this page show which version applies. If a change is significant, we will ask you to accept it on your next visit.

## 13. Contact

{{OPERATOR}}. Data Protection Officer: {{CONTACT}}.

If you are not satisfied with our reply, you may contact Singapore's Personal Data Protection Commission.
