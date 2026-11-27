# PALASH AI — Social Integrations

## Connect an account

Open Agents & Queue → Integrations, select a provider, enter the provider-issued access token and required account identifier, then submit. PALASH AI verifies the credential with the provider before saving it.

Credentials are encrypted using AES-256-GCM before being stored in the Neon agent_settings table. Stored tokens are not returned by the status API. Disconnecting a provider deletes its encrypted credential.

Never paste access tokens into chat, task descriptions, GitHub issues, or source files. Use only the dedicated integration credential form.

## Supported providers

| Provider | Required values | Verified capability | Publishing |
|---|---|---|---|
| Facebook Page | Page access token, Page ID | Page identity and token | Text posts after Owner approval |
| Instagram Business | Meta access token, Instagram Business User ID | Business account identity | Image + caption after Owner approval; image URL must be publicly reachable over HTTPS |
| LinkedIn | Member access token; author URN can be derived from identity | Member identity | Public text posts after Owner approval |
| YouTube | Google OAuth access token | Channel identity | Not enabled; video upload workflow is not implemented |
| WhatsApp Business | Cloud API token, Phone Number ID | Phone-number identity | Not enabled; message dispatch is not implemented |

GitHub and Cloudflare status may also appear in the integration status list, but their connection workflows are managed from GitHub Engineering and deployment settings respectively.

## Provider permissions

- Facebook Page: pages_manage_posts and the Page access required for the selected Page.
- Instagram Business: instagram_basic, instagram_content_publish, and the required linked Facebook Page permissions.
- LinkedIn: w_member_social, openid, and profile access.
- YouTube: youtube.readonly for channel verification. Upload/publishing is not implemented.
- WhatsApp Business: token access for the selected Phone Number ID. Message dispatch is not implemented.

Provider app review, account eligibility, business verification, scopes, rate limits, and token expiry remain controlled by each platform.

## Publishing workflow

1. Ask PALASH AI to draft a post and name the target provider.
2. For Instagram, include a public HTTPS image URL that the provider can fetch.
3. Review the generated task/approval preview carefully.
4. Approve only the exact post you intend to publish.
5. Confirm the provider response and task/approval result before treating the post as published.

Facebook Page text posts, Instagram image posts, and LinkedIn text posts are supported. YouTube and WhatsApp are connection-verification only. A draft is not a published post.

## Safety

Social publishing requires mandatory Owner approval. The approval must correspond to the exact preview. If provider publishing fails, PALASH AI must report the provider error rather than mark the post as published. Keep Emergency Stop available and disconnect credentials that are no longer needed.
