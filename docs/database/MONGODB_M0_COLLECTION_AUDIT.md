# MongoDB Atlas M0 Collection Audit

This is the static baseline from the current Mongoose models. Run
`npm run db:m0:audit -- --output .data/audits/mongodb-m0` against each
environment for live counts and sizes. Unknown database-only collections
require review; the audit tool never drops collections.

| Group | Collections | Decision |
|---|---|---|
| Core content | `articles`, `comments`, `courses`, `enrollments`, `featuredstudents`, `jobs`, `partners`, `prompts`, `resources`, `reviews` | Keep |
| Identity and billing | `users`, `transactions`, `webhooklogs`, `systemsettings` | Keep; `webhooklogs` uses 90-day TTL |
| Workflow | `workflowprojects`, `workflowdocuments` | Keep; bound embedded history and store file bytes externally |
| Infrastructure | `flowservers`, `hostmachines`, `cloudsessions`, `chatmessages` | Keep; sessions/chat use retention |
| Interior business | `interiorprojects`, `interiortemplates`, `interior_quota`, `interior_analysis`, `interior_renders` | Keep; archive old project versions to object storage |
| Interior diagnostics | `interiorailogs`, `interioragentlogs` | Keep with retention |
| Studio | `studiogenerations` | Keep with retention; only media keys/URLs belong in MongoDB |
| CRM business | `crmbillingorders`, `crmcampaigns`, `crmchatbotrules`, `crmcontacts`, `crmconversations`, `crmdevices`, `crmgroupcheckpoints`, `crmgroupinsights`, `crmgroupsummaries`, `crmsegments`, `crmsubscriptions`, `crmtasks`, `crmtemplates`, `crmzalogroups` | Keep |
| CRM overlap | `crmcustomers` | Merge candidate with `crmcontacts`; do not merge until route/reference migration is designed |
| CRM retained | `crmagentcommands`, `crmauditlogs`, `crmchatbotlogs`, `crmexecutionlogs`, `crmgroupmessages`, `crmmessages`, `crmpairingsessions` | Keep with TTL/purge retention |
| CRM usage | `crmaiusages` | Keep; aggregate usage records before considering archive |
| Vocab | `vocabpublicdecks`, `vocabpublicflashcards`, `vocabdeckratings`, `vocabimportlinks`, `vocabprofiles`, `vocabfeedbacks`, `vocabprivatedecks`, `vocabprivateflashcards`, `vocab_chinese_dictionaries` | Keep |

## Index Policy

- Required TTL indexes are applied only by `npm run db:m0:audit -- --apply-indexes`.
- Runtime startup does not create, drop, or repair indexes explicitly.
- The only approved legacy drop is `partners.userId_1`.
- Prefix-based recommendations exclude unique, partial, sparse, text, wildcard, and TTL indexes.
- Any collection removal or CRM merge requires a separate reviewed migration and backup.
