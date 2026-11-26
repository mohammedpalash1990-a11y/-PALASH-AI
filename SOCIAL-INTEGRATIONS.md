# PALASH AI Social Integrations

## Connection flow

Open **Agents & Queue → Agent Memory & Project Context → Connect a social account**. Paste a provider-issued access token and the required account identifier. PALASH AI verifies the token against the provider before saving it.

Access tokens are encrypted with AES-256-GCM before being stored in the Neon agent_settings table. The API never returns stored tokens. Disconnect removes the encrypted credential.

## Supported connections

| Provider | Required values | Verified capability | Publishing |
|---|---|---|---|
| Facebook Page | Page access token, Page ID | Page identity and token | Text posts to the connected Page |
| Instagram Business | Meta access token, Instagram Business User ID | Business account identity | Image + caption; image URL must be publicly reachable |
| LinkedIn | Member access token; author URN optional | Member identity via /v2/userinfo | Public text posts |
| YouTube | Google OAuth access token | Channel identity | Not enabled; video upload workflow is separate |
| WhatsApp Business | Cloud API token, Phone Number ID | Phone-number identity | Connection verification only; message dispatch is not enabled |

## Required provider permissions

- **Facebook Page:** pages_manage_posts and the Page access needed to manage the selected Page.
- **Instagram Business:** instagram_basic, instagram_content_publish, and the required linked Facebook Page permissions.
- **LinkedIn:** w_member_social, openid, and profile.
- **YouTube:** youtube.readonly for channel verification. Upload/publishing is not implemented.
- **WhatsApp Business:** the token must be valid for the selected Phone Number ID. Message dispatch is not implemented.

Provider approval, app review, business verification, account eligibility, and rate limits remain controlled by each platform.

## Publishing safety

A social publishing command creates a draft task and a mandatory Owner approval. The post is sent only after the Owner approves the exact preview. Facebook Page text posts, Instagram image posts, and LinkedIn text posts are supported. YouTube and WhatsApp are connection-only in this release.

If a provider request fails, the approval remains pending and PALASH AI reports the provider error; it does not mark the post as published.

## Credential handling

Use long-lived, least-privilege tokens. Do not paste tokens into chat messages or task descriptions; use the password field in the connection form. Anyone with access to the Owner account can publish after approval, so protect the Owner login and keep Emergency Stop available.
