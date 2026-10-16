-- Drop omnichannel tables: Conversation, Message, CannedResponse
-- Contact is retained as it is used by the contact center (leads, campaigns).

DROP TABLE IF EXISTS "Message" CASCADE;
DROP TABLE IF EXISTS "Conversation" CASCADE;
DROP TABLE IF EXISTS "CannedResponse" CASCADE;
