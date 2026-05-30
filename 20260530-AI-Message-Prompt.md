# user
I'm building a CRM and messaging application.  One of the functionalities I'm experimenting with using the CRM is having AI assisted messaging.  When you're doing an outreach campaign, we have 3 questions:

* Who?

* What?

* When?

We will come into this with one of the questions known, and I have access to the people database.  So say I'm running a political PAC against gun violence in New York City, and the customers are voters that we're soliciting for fundraising.  Additional consumer preference information, and anything else known about the people will be available as notes in the CRM.

The CRM supports scheduling sending a email and text messages, so when a message is desired, it can be added as a task and the system will process the task at the appropriate time.

I want this workflow:

* User creates an outreach campaign (Salesforce terminology).

* GUI prompt, which question do you have, basically radio buttons for who/what/when, and a text box for a description of what we want to talk about.

* I choose "What" and let's say I want to talk about preventing school shootings / violence as the subject matter.

* The user will be prompted if they have anything else, and to restrict it to certain people (e.g. only women, only Democrats, only people in NY-12) so we don't need to overprocess or send messages to irrelevant people.  The user will also be asked if we should try to target ALL of the people here even if the message is a poor fit (more on that below), and if we want to limit this to a single outreach message, a limit of some variant of messages, or have an individual message for each person.

Now for the technical part, the approach I came up with now is to:

* make a directory on the server.   Write an instructions.md in containing the prompt from the user, an explanation of the database context, and what we're trying to accomplish.
* Invoke an AI agent (Codex, Claude Code, OpenCode, etc) in automation mode and have it look through the database of people to try to find who we should send this message to.  At this point, this is as much an exercise in prompt engineering as it is a data exercise.  This can take a relatively long time.  Once an output file is created - basically a table of messages that we will send to users (what) and who the users are (who), the user will be prompted to review this.  We can then either manually schedule a send, or request the AI agent again to work out the when, which can vary by person (e.g. in a neighborhood with a lot of parents, and the people are aged 27-55, we might want to target this message to be around the time of school pickup so it's fresh on the recipient's mind)

Is this an appropriate design?   It doesn't necessarily need to be an agent running on the server, but that may be an easy way to control this with minimal dev overhead.

# agent
Yes, the broad design is appropriate as an **AI-assisted campaign planning workflow**, but I would not make “agent writes files in a directory and roams the DB” the core production abstraction. That is a good prototype. For production, I’d keep the agent-like behavior but wrap it in a structured job system with scoped data access, deterministic outputs, audit logs, and human approval gates.

For a CRM/messaging product, I’d think of this as four separate layers:

1. **Campaign intent capture**: who / what / when, constraints, exclusions, compliance requirements.
2. **Audience selection**: find eligible recipients from the CRM.
3. **Message generation / variant generation**: draft copy, personalization fields, rationale.
4. **Scheduling / delivery orchestration**: send time, channel, throttling, opt-outs, review and approval.

Your idea maps well to those layers, but I’d tighten the interfaces between them.

## What I like about your design

The “known question” framing is strong. “Who / what / when” is a useful mental model because the AI can fill in missing campaign dimensions:

| Known input | AI-assisted output                                |
| ----------- | ------------------------------------------------- |
| Who         | What to say, when to say it                       |
| What        | Who should receive it, what variants to use, when |
| When        | Who is appropriate, what message fits that moment |

The user flow is also right: before the system does expensive analysis, ask for scoping criteria, exclusions, whether to target everyone or only good-fit recipients, and whether the output should be one message, variants, or individual messages.

The review step is essential. Especially for political, fundraising, health, financial, or sensitive-topic outreach, the system should produce **recommendations and drafts**, not silently send generated messages.

## Where I would change the technical approach

Using a directory with `instructions.md` plus a coding agent is fine as an MVP, but I’d avoid giving a general-purpose agent broad database access in production.

A better version is:

```text
Campaign
  ↓
Structured planning job
  ↓
Audience query / retrieval
  ↓
LLM reasoning over bounded candidate set
  ↓
Structured output: recipients, message variants, rationale, exclusions
  ↓
Human review
  ↓
Approved send tasks
  ↓
Messaging scheduler
```

The important change is that the AI should usually not “look through the database” freely. It should receive a **bounded, queryable view** of the relevant people and a schema describing what fields mean. For example:

```json
{
  "campaign_goal": "fundraising outreach about preventing school violence",
  "known_dimension": "what",
  "audience_constraints": {
    "state": "NY",
    "district": "NY-12",
    "party": ["Democrat", "Independent"],
    "exclude": ["opted_out", "do_not_contact"]
  },
  "personalization_mode": "variants",
  "max_variants": 5,
  "send_mode": "draft_for_review"
}
```

Then the system can generate a structured result like:

```json
{
  "audience_summary": "...",
  "excluded_count": 1832,
  "recommended_count": 741,
  "segments": [
    {
      "segment_name": "Public school parents",
      "selection_reason": "...",
      "recipient_ids": ["..."],
      "message_variant_id": "v1",
      "risk_notes": ["Sensitive-topic message; requires review"]
    }
  ],
  "message_variants": [
    {
      "id": "v1",
      "channel": "sms",
      "body": "...",
      "compliance_footer": "Reply STOP to opt out."
    }
  ]
}
```

That gives you the benefits of agentic work without making the agent the source of truth.

## The biggest production risks

### 1. Compliance and consent

For email and SMS, especially political or fundraising outreach, the product needs hard compliance rails. The FCC’s political robocall/robotext guidance says political campaigns must follow restrictions around autodialed/prerecorded calls and robotexts, including consent requirements in some contexts, identification requirements, and opt-out handling. ([Federal Communications Commission][1])

For SMS, carrier ecosystem rules also matter. CTIA emphasizes that political messaging platforms should follow messaging best practices to avoid unwanted-message filtering and protect consumers from spam-like outreach. ([CTIA][2]) For 10DLC/A2P texting, opt-in, opt-out, sender identity, and campaign registration are not optional product details; they need to be part of the workflow.

So I would model compliance as first-class data:

```text
person.can_email
person.can_sms
person.sms_opt_in_source
person.opted_out_at
person.do_not_contact
person.jurisdiction
campaign.disclaimer_required
campaign.approval_required
message.legal_basis
message.disclaimer
message.opt_out_text
```

### 2. AI-generated political content rules

The regulatory landscape for AI in political communications is moving quickly. The FEC voted in September 2024 not to open a new AI-specific rulemaking, but adopted an interpretive rule explaining how existing fraudulent misrepresentation rules apply to deceptive AI campaign activity. ([FEC.gov][3]) Separately, state laws are developing quickly; NCSL’s tracker notes that states have been responding to generative AI and deepfakes in elections, especially around synthetic media disclosures. ([NCSL][4])

For New York specifically, there has been legislative activity around AI disclaimers in political communications, including a proposed “political artificial intelligence disclaimer” act requiring disclosure for synthetic media. ([NYSenate.gov][5]) New York has also enacted AI-related advertising disclosure laws for synthetic performers, with effective dates in 2026 for certain provisions. ([Reuters][6])

Practical product implication: build a **jurisdictional disclaimer engine** now, even if the first version is conservative and manually configurable.

### 3. Sensitive targeting and manipulation risk

Because your example involves political fundraising and voter outreach, I would separate “CRM segmentation” from “AI persuasion.” It is reasonable to use CRM fields to avoid irrelevant or non-consented outreach. It is much riskier to let an AI infer psychological vulnerabilities or generate highly personalized political persuasion based on sensitive traits.

Product guardrail I’d add:

```text
Allowed:
- Eligibility filtering
- Consent filtering
- Jurisdiction filtering
- Prior engagement filtering
- Broad message variants
- Accessibility / language preferences
- Donor history where legally permitted

Restricted or requires explicit policy review:
- Political persuasion based on inferred emotions
- Sensitive-trait targeting
- Fear-based personalization
- Individualized manipulative messaging
- Hidden AI-generated synthetic media
```

For a CRM platform, you want the AI to be an **assistant to staff**, not a black-box persuasion engine.

## Agent vs normal backend job

An agent on the server is acceptable for experimentation, but I’d graduate it into a job pipeline.

### MVP version

Your directory approach is fine:

```text
/jobs/campaign_123/
  instructions.md
  input_people.jsonl
  schema.md
  output_messages.csv
  audit.json
```

Then run Codex / Claude Code / OpenCode against that folder.

This is fast to build, debuggable, and lets you inspect the output.

### Production version

I’d use:

```text
campaign_jobs
campaign_job_inputs
campaign_job_outputs
campaign_message_variants
campaign_recipients
campaign_send_tasks
campaign_audit_events
```

The LLM receives JSON or JSONL, not raw DB access. The output must conform to a schema. Invalid output fails validation. Every recommendation should include a short reason and confidence/risk label.

## Recommended workflow

A strong production workflow would be:

```text
1. User creates campaign
2. User selects known dimension: Who / What / When
3. User describes intent
4. User sets scope and exclusions
5. System estimates audience size and compliance constraints
6. AI creates campaign plan
7. AI proposes audience segments and message variants
8. System validates:
   - opt-outs
   - consent
   - jurisdiction
   - frequency caps
   - forbidden claims
   - missing disclaimers
9. Human reviews
10. Human approves selected recipients/messages
11. Scheduler creates send tasks
12. Delivery system sends
13. Results feed back into CRM
```

The key is that AI can propose, but the system validates.

## “Should we target all people even if the message is a poor fit?”

This is a good product question to ask, but I’d phrase it carefully in the UI.

Instead of:

> Should we try to target all people even if the message is a poor fit?

Use something like:

> Outreach coverage:
> **Best-fit only** — contact people with a clear relevance signal.
> **Broad eligible audience** — contact all eligible, consented people within the selected scope.
> **Manual review required for low-fit recipients** — include borderline recipients but require approval.

That keeps the workflow operational rather than encouraging the AI to force-fit persuasive messaging.

## Message generation modes

I’d support four modes:

| Mode                     | Use case                                            | Risk   |
| ------------------------ | --------------------------------------------------- | ------ |
| Single message           | Newsletter-style blast                              | Low    |
| Segment variants         | Different copy by broad audience group              | Medium |
| Template personalization | Name, neighborhood, prior donation, event reference | Medium |
| Fully individual message | One unique message per person                       | High   |

For political/fundraising use cases, I would default to **single message** or **segment variants**, with stronger review requirements for fully individualized messages.

## “When” optimization

Scheduling can be useful, but I’d make it rules-based first and AI-assisted second.

Good scheduling inputs:

```text
timezone
legal quiet hours
channel limits
prior engagement time
frequency caps
campaign deadline
event date
recipient locale
known communication preference
```

For example, the AI can suggest:

```json
{
  "recommended_send_window": "2026-06-03T15:00:00-04:00/2026-06-03T17:00:00-04:00",
  "reason": "Afternoon send window; avoids late-night messaging and aligns with prior engagement patterns.",
  "requires_review": false
}
```

I would avoid letting the AI choose emotionally exploitative timing. “Send around school pickup so the issue is fresh” is the kind of idea that may be persuasive, but it also crosses into a riskier design space for political messaging. Safer framing: optimize for deliverability, recipient preference, legal sending windows, and historical engagement.

## Data model sketch

You probably want entities like:

```text
Campaign
- id
- name
- known_dimension: who | what | when
- objective
- jurisdiction
- status
- created_by
- approval_policy

CampaignBrief
- campaign_id
- user_prompt
- constraints
- exclusions
- personalization_mode
- coverage_mode

AudienceCandidate
- campaign_id
- person_id
- eligibility_status
- relevance_score
- reason
- exclusion_reason

MessageVariant
- campaign_id
- variant_id
- channel
- subject
- body
- segment_label
- compliance_disclaimer
- risk_level

RecipientMessage
- campaign_id
- person_id
- variant_id
- rendered_subject
- rendered_body
- send_window
- approval_status

SendTask
- recipient_message_id
- channel
- scheduled_at
- status
- provider_message_id

AuditEvent
- actor
- action
- timestamp
- input_hash
- output_hash
- model
- policy_version
```

The `AuditEvent` table is especially important. For sensitive campaign work, you want to know exactly why someone was included, what model generated the message, what prompt was used, who approved it, and what was sent.

## Better than “agent has DB access”

Give the agent/tools narrow capabilities:

```text
search_people(query)
get_people_by_ids(ids)
summarize_segment(ids)
create_message_variants(brief, segment)
validate_message(message, jurisdiction, channel)
create_send_tasks(approved_messages)
```

Do not let it execute arbitrary SQL against production unless it is in a tightly sandboxed read-only replica with row limits, query logging, and PII controls.

## Output should include rationale

For every recipient or segment, require:

```json
{
  "included": true,
  "reason": "Matched campaign scope and has prior engagement with education-related fundraising.",
  "data_used": ["district", "prior_engagement_tag", "sms_opt_in"],
  "risk_flags": []
}
```

This gives reviewers something actionable and makes the system easier to debug.

## My overall recommendation

Use the agent-directory approach for prototyping, but design the production system around **structured jobs, scoped retrieval, schema-validated outputs, and human approval**.

The right architecture is not:

```text
AI agent wanders through CRM → creates send list → scheduler sends
```

It should be:

```text
User brief → scoped candidate set → AI proposes plan/messages → deterministic validation → human approval → scheduled send tasks
```

That gives you the flexibility of agentic AI while keeping the CRM reliable, auditable, and safer for regulated or sensitive outreach.

[1]: https://www.fcc.gov/consumers/guides/political-campaign-robocalls-and-robotexts-rules?utm_source=chatgpt.com "Political Campaign Robocalls and Robotexts Rules"
[2]: https://www.ctia.org/news/political-text-messaging-engaging-and-organizing-voters-while-protecting-consumers?utm_source=chatgpt.com "Political Text Messaging: Engaging and Organizing Voters ..."
[3]: https://www.fec.gov/updates/commission-approves-notification-of-disposition-interpretive-rule-on-artificial-intelligence-in-campaign-ads/?utm_source=chatgpt.com "Notification of Disposition for Rulemaking"
[4]: https://www.ncsl.org/elections-and-campaigns/artificial-intelligence-ai-in-elections-and-campaigns?utm_source=chatgpt.com "Artificial Intelligence (AI) in Elections and Campaigns"
[5]: https://www.nysenate.gov/legislation/bills/2025/S2414?utm_source=chatgpt.com "NY State Senate Bill 2025-S2414"
[6]: https://www.reuters.com/legal/legalindustry/new-york-legislation-requires-disclosure-ai-generated-performers-advertising--pracin-2026-02-05/?utm_source=chatgpt.com "New York legislation requires disclosure on AI-generated performers in advertising and strengthens post-mortem publicity rights"


