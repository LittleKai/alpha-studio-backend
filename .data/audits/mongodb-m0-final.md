# MongoDB M0 Live Audit

Generated: 2026-06-12T03:21:50.530Z

| Collection | Documents | Storage bytes | Index bytes | Classification | Recommendation |
|---|---:|---:|---:|---|---|
| api_usage | 0 | 4,096 | 20,480 | remove-candidate | Confirm no external writer, then archive metadata and remove manually. |
| articles | 10 | 110,592 | 282,624 | keep | Keep; remove only redundant indexes after query review. |
| chatmessages | 8 | 36,864 | 110,592 | keep-with-retention | Keep TTL/index policy and monitor monthly growth. |
| cloudsessions | 14 | 36,864 | 147,456 | keep-with-retention | Keep TTL/index policy and monitor monthly growth. |
| comments | 3 | 36,864 | 184,320 | keep | Keep; remove only redundant indexes after query review. |
| courses | 2 | 36,864 | 368,640 | keep | Keep; remove only redundant indexes after query review. |
| crmagentcommands | 61 | 61,440 | 331,776 | keep-with-retention | Keep TTL/index policy and monitor monthly growth. |
| crmaiusages | 1 | 36,864 | 147,456 | keep | Keep; remove only redundant indexes after query review. |
| crmauditlogs | 16 | 36,864 | 147,456 | keep-with-retention | Keep TTL/index policy and monitor monthly growth. |
| crmbillingorders | 1 | 36,864 | 147,456 | keep | Keep; remove only redundant indexes after query review. |
| crmcampaigns | 10 | 36,864 | 147,456 | keep | Keep; remove only redundant indexes after query review. |
| crmchatbotlogs | 1 | 36,864 | 221,184 | keep-with-retention | Keep TTL/index policy and monitor monthly growth. |
| crmchatbotrules | 1 | 36,864 | 184,320 | keep | Keep; remove only redundant indexes after query review. |
| crmcontacts | 0 | 4,096 | 16,384 | keep | Keep; remove only redundant indexes after query review. |
| crmconversations | 18 | 45,056 | 331,776 | keep | Keep; remove only redundant indexes after query review. |
| crmcustomers | 1 | 36,864 | 294,912 | merge-candidate | Review reads/writes and migrate references before any merge. |
| crmdevices | 3 | 36,864 | 258,048 | keep | Keep; remove only redundant indexes after query review. |
| crmexecutionlogs | 9 | 36,864 | 221,184 | keep-with-retention | Keep TTL/index policy and monitor monthly growth. |
| crmgroupcheckpoints | 0 | 4,096 | 20,480 | keep | Keep; remove only redundant indexes after query review. |
| crmgroupinsights | 0 | 4,096 | 32,768 | keep | Keep; remove only redundant indexes after query review. |
| crmgroupmessages | 0 | 4,096 | 24,576 | keep-with-retention | Keep TTL/index policy and monitor monthly growth. |
| crmgroupsummaries | 0 | 4,096 | 20,480 | keep | Keep; remove only redundant indexes after query review. |
| crmmessages | 284 | 139,264 | 311,296 | keep-with-retention | Keep TTL/index policy and monitor monthly growth. |
| crmpairingsessions | 3 | 36,864 | 294,912 | keep-with-retention | Keep TTL/index policy and monitor monthly growth. |
| crmsegments | 0 | 4,096 | 12,288 | keep | Keep; remove only redundant indexes after query review. |
| crmsubscriptions | 2 | 36,864 | 147,456 | keep | Keep; remove only redundant indexes after query review. |
| crmtasks | 0 | 4,096 | 36,864 | keep | Keep; remove only redundant indexes after query review. |
| crmtemplates | 11 | 36,864 | 110,592 | keep | Keep; remove only redundant indexes after query review. |
| crmzalogroups | 48 | 45,056 | 221,184 | keep | Keep; remove only redundant indexes after query review. |
| enrollments | 12 | 36,864 | 147,456 | keep | Keep; remove only redundant indexes after query review. |
| featuredstudents | 3 | 36,864 | 110,592 | keep | Keep; remove only redundant indexes after query review. |
| flowservers | 1 | 36,864 | 110,592 | keep | Keep; remove only redundant indexes after query review. |
| hostmachines | 1 | 36,864 | 110,592 | keep | Keep; remove only redundant indexes after query review. |
| interior_analysis | 0 | 4,096 | 16,384 | keep-with-retention | Keep TTL/index policy and monitor monthly growth. |
| interior_quota | 0 | 4,096 | 12,288 | keep | Keep; remove only redundant indexes after query review. |
| interior_renders | 0 | 4,096 | 12,288 | keep | Keep; remove only redundant indexes after query review. |
| interioragentlogs | 20 | 499,712 | 331,776 | keep-with-retention | Keep TTL/index policy and monitor monthly growth. |
| interiorailogs | 21 | 147,456 | 221,184 | keep-with-retention | Keep TTL/index policy and monitor monthly growth. |
| interiorprojects | 35 | 131,072 | 147,456 | keep | Keep; remove only redundant indexes after query review. |
| interiortemplates | 274 | 237,568 | 307,200 | keep | Keep; remove only redundant indexes after query review. |
| jobs | 1 | 36,864 | 221,184 | keep | Keep; remove only redundant indexes after query review. |
| partners | 1 | 36,864 | 258,048 | keep | Keep; remove only redundant indexes after query review. |
| projects | 0 | 4,096 | 16,384 | remove-candidate | Confirm no external writer, then archive metadata and remove manually. |
| prompts | 1 | 36,864 | 442,368 | keep | Keep; remove only redundant indexes after query review. |
| resources | 2 | 36,864 | 442,368 | keep | Keep; remove only redundant indexes after query review. |
| reviews | 1 | 36,864 | 147,456 | keep | Keep; remove only redundant indexes after query review. |
| students | 0 | 4,096 | 12,288 | remove-candidate | Confirm no external writer, then archive metadata and remove manually. |
| studio_sessions | 0 | 4,096 | 16,384 | remove-candidate | Confirm no external writer, then archive metadata and remove manually. |
| studiogenerations | 5 | 36,864 | 147,456 | keep-with-retention | Keep TTL/index policy and monitor monthly growth. |
| systemsettings | 9 | 36,864 | 73,728 | keep | Keep; remove only redundant indexes after query review. |
| transactions | 22 | 36,864 | 331,776 | keep | Keep; remove only redundant indexes after query review. |
| transformations | 0 | 4,096 | 20,480 | remove-candidate | Confirm no external writer, then archive metadata and remove manually. |
| users | 18 | 36,864 | 147,456 | keep | Keep; remove only redundant indexes after query review. |
| vocab_chinese_dictionaries | 66447 | 9,617,408 | 5,083,136 | keep | Keep; remove only redundant indexes after query review. |
| vocabdeckratings | 0 | 4,096 | 16,384 | keep | Keep; remove only redundant indexes after query review. |
| vocabfeedbacks | 0 | 4,096 | 8,192 | keep | Keep; remove only redundant indexes after query review. |
| vocabimportlinks | 0 | 4,096 | 24,576 | keep | Keep; remove only redundant indexes after query review. |
| vocabprivatedecks | 2 | 36,864 | 184,320 | keep | Keep; remove only redundant indexes after query review. |
| vocabprivateflashcards | 2 | 36,864 | 184,320 | keep | Keep; remove only redundant indexes after query review. |
| vocabprofiles | 1 | 36,864 | 110,592 | keep | Keep; remove only redundant indexes after query review. |
| vocabpublicdecks | 0 | 4,096 | 32,768 | keep | Keep; remove only redundant indexes after query review. |
| vocabpublicflashcards | 0 | 4,096 | 8,192 | keep | Keep; remove only redundant indexes after query review. |
| webhooklogs | 1 | 36,864 | 221,184 | keep-with-retention | Keep TTL/index policy and monitor monthly growth. |
| workflowdocuments | 2 | 36,864 | 36,864 | keep | Keep; remove only redundant indexes after query review. |
| workflowprojects | 2 | 36,864 | 36,864 | keep | Keep; remove only redundant indexes after query review. |
