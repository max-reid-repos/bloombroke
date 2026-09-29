# Privacy Policy

This policy explains what personal data Bloombroke collects, why, who receives it, how long we keep it and what you can ask us to do. We follow Singapore's Personal Data Protection Act 2012 (the "PDPA").

## 1. Who we are

{{OPERATOR}} ("we", "us") runs bloombroke.com. We decide how your personal data is used.

Our Data Protection Officer can be reached at {{CONTACT}}. Write to this address for any question, request or complaint about your personal data.

## 2. The short version

- You can use the free terminal without an account, a name or an email address.
- Your watchlist, portfolio, saved wage, command history and screen layouts are stored in your own browser, not on our servers, unless you turn on Pro sync.
- We count visits with DataFast, and Cloudflare counts page views without cookies. If your browser sends Global Privacy Control, we do not load DataFast.
- Sponsor links carry no tracking codes, and sponsors get no data from us.
- Pro payments go through Stripe. We never see your full card number.
- CHAT messages between Pro members are seen only by the people in that chat, unless a chat is reported, and are deleted after 30 days.
- We do not use your data to train AI models, we do not sell it, and we do not send marketing messages.

## 3. What we collect and why

### Using the free terminal

- **Requests to our server.** When you open a screen, your browser asks our server for data, such as the symbols on your watchlist. Our server passes the symbols to the data source and sends back the result. We use these requests only to answer them. When you open a ticker screen, your browser sends its symbol and a random number made for that browser tab. To count each tab once and to stop abuse, our server keeps a coded copy of that number and of your IP address, with the tickers opened, in memory for one hour, then only the count per ticker for 24 hours. Nothing is written to disk. Apart from this count, we do not keep a record of which symbols a person asked for.
- **Your IP address.** Every connection reveals your IP address. Our network provider, Cloudflare, uses it to deliver the site and block attacks. Our application does not write IP addresses to its logs. To stop abuse and the guessing of licence keys and gift codes, it limits how often each visitor can use the Pro routes and gift codes (a 10 or 15 minute window), the ticker counter, the site counters, the GUESS game and the pay respects button on GRAVEYARD stones (a one minute window), the feedback form (a one hour window) and the MCP endpoint (a one minute, a 10 minute and a 24 hour window). For this it holds your IP address in memory, or for the ticker counter a coded copy of it, for the length of the window, and forgets it within one minute after the window ends.
- **The MCP endpoint.** When an AI app such as Claude, ChatGPT, Grok or Cursor calls our MCP endpoint (bloombroke.com/mcp) for you, our server answers the request and counts it per tool. The count has no IP address and nothing of what was asked. We do not store the inputs a tool is called with: our logs keep only the tool name and whether the call worked. Your IP address is held only in its rate limiter, for the windows given under "Your IP address" above and in section 8. What you type into the AI app is covered by that app's own privacy policy.
- **Pay respects.** On a GRAVEYARD stone, pay respects (the F key or its button) adds one to a total for that stone. The totals are aggregate counts per stone, with no IP address and nothing about who paid them. Your IP address is held only in the rate limiter, for the one minute window above. So that each stone gets at most one respect from you a day, our server also keeps a coded copy (a salted hash) of your IP address and the stone in memory until the end of that New York day, with a new salt each day, and never writes it to disk.
- **Videos on GRAVEYARD stones.** A stone page shows our own drawing in place of a video, and nothing is loaded from YouTube or Google until you press play. When you press play on a GRAVEYARD video, the video is loaded from YouTube (Google) in its privacy-enhanced mode (youtube-nocookie.com), and Google receives your IP address and device data under its own privacy policy.
- **Error logs.** When something breaks, our server writes an error message to its logs. These messages do not contain your IP address, and we aim to delete them within 14 days.
- **Your browser storage.** The terminal saves some things in your browser's local storage so they are there next time: your watchlist, portfolio, saved wage, recent commands, screen layouts, your acceptance of these terms (with its version and time) and, for Pro, your licence key. This data stays on your device. We cannot see it unless you use Pro sync. You can delete it at any time by clearing this site's data in your browser.

### Analytics

We use DataFast (datafa.st) to understand how many people visit and which screens they use. The DataFast script sets two first-party cookies: datafast_visitor_id, which lasts about one year, and datafast_session_id, which lasts about 30 minutes. It sends DataFast the page address, the referring page, your browser, operating system, device type, screen size, language and time zone, and it records clicks on links that lead to other sites. DataFast uses your IP address to work out your approximate location, such as your country and city. We use this only as totals and trends, and we do not use it to identify you.

- **Global Privacy Control.** If your browser sends a Global Privacy Control (GPC) signal, we do not load DataFast on any page of bloombroke.com.
- **Feature events.** When you use certain features, such as a WHATIF result or a GUESS game, we send DataFast an event with the feature's name and, for some features, a short fixed label, such as how a result was shared. The event itself carries no personal data, but DataFast links it to the same visitor and session cookies as your visits.
- **Cloudflare Web Analytics.** Cloudflare, our network provider, adds its own count of page views and page load times. Cloudflare states that it does not use cookies for this and does not identify visitors. It is not affected by GPC.
- **Our own counters.** Our server keeps daily totals of some actions, such as WHATIF results, GUESS games, feedback notes, MCP tool calls, and how many times sponsor-strip lines were shown and clicked. These are totals only, with no IP address and nothing about who did what, so we keep them even when your browser sends GPC.
- **What we publish.** We publish aggregate visitor numbers on our BBRK screen, including visitor counts by country, from DataFast totals; a country or referring site with fewer than three visitors is not shown on its own, and we publish approximate locations: country totals, and city dots rounded to about 100 km, only for places with three or more visitors in the last seven days; never anything about a single visitor.

### Pro subscribers

If you subscribe to Pro, we also process:

- **Your licence record.** A one-way hash of your licence key and its last four characters (never the key in plain text), your Stripe customer ID, subscription ID and checkout session ID, your subscription status and its dates, whether you pay monthly or yearly, your seat number, and the time you accepted the Terms at checkout. We show your seat number to you on your own screen. For 24 hours after checkout we also keep an encrypted copy of your key so the success page can show it to you; after that it is deleted.
- **Synced data.** If you use sync, the watchlist, portfolio, ticker tape and DESK layouts in your browser are stored on our server, linked to your licence, so they can appear on your other devices.
- **Payment data.** Stripe collects your name, email address, billing address and card details. Stripe tells us your email address, name, billing country, the brand and last four digits of your card and your payment history, which we use to run your subscription, send receipts and deal with problems. We do not receive your full card number.

### Gift codes

- **Making a code.** If you make a gift code, we store a one-way hash of the code and its last four characters (never the code in plain text), which licence made it, when it was made and when it expires, and, once it is used, when it was used and which licence it made.
- **Redeeming a code.** If you redeem a gift code, we make a licence record for you with a one-way hash of your new key and its last four characters, your seat number and the date your gift month ends. It has no Stripe IDs and no payment data, and we do not ask for your name or email address.

### Sponsors

When sponsors run, sponsor lines rotate in the status line, and each is marked SPONSOR and is one plain line of text with a plain link; a WEIRD gauge may show the name of its sponsor. We add no tracking code to the link, we load no sponsor pixels or scripts, and sponsors get no data from us. Our analytics tool, DataFast, counts link clicks, including clicks on sponsor links, as part of its normal site analytics described above. We also count, in total, how many times sponsor-strip lines were shown and clicked; nothing is kept per person. The link asks your browser not to tell the sponsor which page you came from. If you click it, the sponsor's own site and its privacy policy apply.

### Feedback

If you send feedback with the FEEDBACK command, we store your message, your email address if you give one, the screen you were on before FEEDBACK, the time, and which version of our terms was current. We use it to improve the service, and your email address only to reply to you. We do not store your IP address with it. We keep feedback for up to 12 months, then delete it.

### CHAT

If you use CHAT, a Pro feature, we store your seat number, the display name you choose, which seats you asked to chat with and who asked you, who you chat with and who you blocked, the groups you are in, and your messages with the time they were sent. When a message names a $TICKER, we also store that ticker's price at the moment you sent it, so the chat can show the move since. A message is shown only to the people in that chat. We do not read messages or use them for anything else: our server only checks each one for links, which are not allowed, and for $TICKERs. The exception is a report: when you or someone else reports a chat, we store a copy of the last 20 messages of that chat, who reported it, the seats in it and the reason given, and we read that copy to deal with the report. We keep messages for 30 days, then delete them. If you post a GUESS result to a chat, we store its score with the message and delete it after 30 days too; the screens you share with DRIVE go to the people following you live and are not stored.

### When you contact us

If you email us, we receive your email address and whatever you write, and we use them to reply and keep a record of the conversation.

## 4. Purposes

We use personal data only to:

- provide the service and show you the data you ask for;
- run Pro: take payments, give access, sync your data, carry CHAT messages and handle cancellations and refunds;
- deal with reports about CHAT messages;
- keep the service secure, prevent abuse and fraud, and enforce our [Terms of Use](/terms);
- understand how the service is used, in totals, so we can improve it;
- answer your messages and requests, and read your feedback;
- meet our legal, tax and accounting duties.

## 5. Consent

By using Bloombroke, and by clicking ACCEPT on the first-visit notice, you consent to us collecting, using and disclosing your personal data as this policy describes. Where the PDPA lets us process data without consent, for example to meet a legal duty, we may rely on that instead.

You can withdraw your consent at any time by writing to {{CONTACT}}. We will tell you what withdrawing means for you. For example, we cannot provide Pro without your licence record and payment data, so withdrawing consent for those means ending your subscription. You can also stop DataFast by turning on Global Privacy Control in your browser, or by blocking cookies or scripts from datafa.st; the terminal keeps working.

## 6. Who receives your data

We share personal data only with these service providers, which help us run Bloombroke, and only what each one needs:

| Provider | What it does for us | Where |
|---|---|---|
| Stripe | Pro payments and billing | United States and Ireland, among other places |
| Cloudflare | Network, security and delivery for every visit, DNS, page-view counts (Cloudflare Web Analytics), and routing of email sent to {{CONTACT}} | A global network, based in the United States |
| DataFast | Visit analytics, as described in section 3 (not loaded when your browser sends GPC) | Mostly outside the EU, including the United States, as its data processing terms state |
| Hetzner | Hosting: the server that runs Bloombroke and stores Pro data | Ashburn, Virginia, United States |
| Google (Gmail) | The mailbox that receives email sent to {{CONTACT}} | United States, among other places |

We may also disclose personal data when the law requires it, to a regulator or court, to protect our rights or someone's safety, or to a buyer if the service is sold, in which case this policy continues to apply.

We do not sell personal data. We do not share it with advertisers or data brokers. We share nothing about you with sponsors. We do not use your data to train AI models.

## 7. Transfers outside Singapore

Our server and several providers are outside Singapore, so your personal data is transferred to and stored in other countries, including the United States. When we transfer personal data out of Singapore, we take steps required by the PDPA so that it keeps a standard of protection comparable to the PDPA, for example through the providers' data processing terms and the safeguards they commit to.

## 8. How long we keep it

| Data | How long |
|---|---|
| IP addresses in our rate limiters | For the length of the limit window (one minute for the ticker counter, the site counters, GUESS and pay respects; 10 or 15 minutes for the Pro routes and gift codes; one hour for feedback; one minute, 10 minutes and 24 hours for the MCP endpoint), plus at most one minute. Held in memory, never on disk. The pay respects once-a-day check keeps a salted hash of your IP address and the stone until the end of that New York day, in memory, never on disk. |
| Ticker counter | A coded copy of your browser tab's random number and of your IP address, with the tickers opened, for one hour; after that only the count per ticker, for 24 hours. All in memory, never on disk. |
| Error logs on our server | We aim to delete them within 14 days. |
| Records kept by Cloudflare, DataFast and Google | For the periods in their own policies. |
| Pro licence record | The hash and last four characters of your key, your seat number, your Stripe IDs and the dates are kept while your licence exists and for 5 years after your subscription is cancelled, for payment and refund records, and then deleted. A licence whose subscription is unpaid or overdue is kept until the subscription is cancelled. |
| Synced data | Deleted 30 days after your subscription ends, or sooner if you ask. |
| Encrypted copy of your key | Deleted as soon as your browser has saved the key, and at the latest 25 hours after checkout. |
| Payment records | Records of payments that tax and company law require us to keep, such as invoices, are kept for as long as that law requires, normally five years, and are held mainly in Stripe. |
| Gift licences | The licence record is kept for 5 years after the gift month ends, and then deleted. Synced data is deleted 30 days after the gift month ends. |
| Gift code records | Deleted 12 months after the code was used or expired. Your licence record keeps only a count of the redeemed codes that were deleted, so the limit of 3 still applies. |
| Feedback | Up to 12 months, then deleted. |
| Chat messages | Deleted 30 days after they were sent. Chat requests are deleted after 30 days too. |
| Chat reports | Up to 12 months, then deleted. |
| Chat name, contacts and blocks | Deleted 30 days after your Pro ends, or sooner if you ask. |
| Emails | For as long as we need them to deal with your message, and then deleted, unless we need to keep them for a legal reason. |
| Our own counters | Daily totals only. They contain no personal data. |
| Your browser storage | Until you clear it. We have no control over it. |

## 9. Your rights

You may ask us:

- for a copy of the personal data we hold about you, and how it has been used or disclosed in the past year;
- to correct personal data that is wrong or incomplete;
- to delete your Pro data before the end of the 30-day period.

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
