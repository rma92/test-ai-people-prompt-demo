--sqlite3
CREATE TABLE users (
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  user_first_name TEXT,
  user_last_name TEXT,
  user_role TEXT,
  user_is_active INTEGER DEFAULT 1,
  user_notes TEXT
);

CREATE TABLE user_session (
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  user_xid INTEGER NOT NULL REFERENCES users(XID),
  session_token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  user_agent TEXT,
  remote_addr TEXT
);

CREATE TABLE api_key (
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  user_xid INTEGER REFERENCES users(XID),
  api_key_name TEXT,
  api_key_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  notes TEXT
);

--dates should be ISO8601 integers YYYYMMDDhhmmss in Z.
CREATE TABLE account(
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT,
  account_type TEXT,
  account_parent_account_xid INTEGER REFERENCES account(xid),
  account_billing_street TEXT,
  account_billing_street2 TEXT,
  account_billing_street3 TEXT,
  account_billing_city TEXT,
  account_billing_zip TEXT,
  account_billing_state TEXT,
  account_billing_country TEXT,
  account_billing_x REAL,
  account_billing_y REAL,
  account_shipping_street TEXT,
  account_shipping_street2 TEXT,
  account_shipping_street3 TEXT,
  account_shipping_city TEXT,
  account_shipping_zip TEXT,
  account_shipping_state TEXT,
  account_shipping_country TEXT,
  account_phone TEXT,
  account_fax TEXT,
  account_website TEXT,
  account_industry TEXT,
  account_annual_revenue INTEGER,
  account_employees INTEGER,
  account_description TEXT,
  account_source TEXT,
  account_sic_description TEXT,
  account_record_owner_xid INTEGER REFERENCES users(xid),
  account_is_deleted INTEGER DEFAULT 0,
  account_notes TEXT
);

CREATE TABLE contact (
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_first_name TEXT,
  contact_last_name TEXT,
  contact_salutation TEXT,
  contact_street TEXT,
  contact_street2 TEXT,
  contact_street3 TEXT,
  contact_city TEXT,
  contact_zip TEXT,
  contact_state TEXT,
  contact_country TEXT,
  contact_x REAL,
  contact_y REAL,
  contact_mail_street TEXT,
  contact_mail_street2 TEXT,
  contact_mail_street3 TEXT,
  contact_mail_city TEXT,
  contact_mail_zip TEXT,
  contact_mail_state TEXT,
  contact_mail_country TEXT,
  contact_phone TEXT,
  contact_fax TEXT,
  contact_mobile TEXT,
  contact_home_phone TEXT,
  contact_other_phone TEXT,
  contact_assistant_phone TEXT,
  contact_reports_to_xid INTEGER REFERENCES contact(xid),
  contact_email TEXT,
  contact_title TEXT,
  contact_department TEXT,
  contact_assistant_xid INTEGER REFERENCES contact(xid),
  contact_lead_source TEXT,
  contact_birthdate INTEGER,
  contact_description TEXT,
  contact_email_opt_out INTEGER DEFAULT 0,
  contact_email_bounced_reason TEXT,
  contact_email_bounced_date INTEGER,
  contact_record_owner_xid INTEGER REFERENCES users(xid),
  contact_account_xid INTEGER REFERENCES account(xid),
  contact_is_deleted INTEGER DEFAULT 0,
  contact_note TEXT
);

-- contact to multiple accounts
CREATE TABLE account_contact_relation (
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  account_xid INTEGER NOT NULL REFERENCES account(XID),
  contact_xid INTEGER NOT NULL REFERENCES contact(XID),
  relationship_type TEXT,
  notes TEXT
);

--opportunity owner is a user id.
CREATE TABLE opportunity (
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_account_xid INTEGER REFERENCES account(xid),
  opportunity_close_date INTEGER,
  opportunity_amount REAL,
  opportunity_description TEXT,
  opportunity_owner_xid INTEGER REFERENCES users(xid),
  opportunity_stage TEXT,
  opportunity_probability INTEGER,
  opportunity_forecast_category TEXT,
  opportunity_next_step TEXT,
  opportunity_is_deleted INTEGER DEFAULT 0,
  opportunity_note TEXT
);

CREATE TABLE campaign (
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_status TEXT,
  campaign_name TEXT,
  campaign_active INTEGER,
  campaign_type TEXT,
  campaign_parent_campaign_xid INTEGER REFERENCES campaign(xid),
  campaign_description TEXT,
  campaign_start_date INTEGER,
  campaign_end_date INTEGER,
  campaign_expected_revenue INTEGER,
  campaign_budgeted_cost INTEGER,
  campaign_actual_cost INTEGER,
  campaign_num_sent INTEGER,
  campaign_expected_response REAL,
  campaign_is_deleted INTEGER DEFAULT 0,
  campaign_notes TEXT
);

CREATE TABLE campaign_members (
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_xid INTEGER NOT NULL REFERENCES campaign(XID),
  campaign_contact_xid INTEGER NOT NULL REFERENCES contact(XID),
  campaign_member_status TEXT,
  campaign_member_notes TEXT
);

-- an event can be a scheduled event or something that happened in the past
-- the event can also be an email or a phone call, as well as some automatic analysis or adding a note.
CREATE TABLE event (
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  event_subject TEXT,
  event_type TEXT,
  event_description TEXT,
  event_start_time INTEGER,
  event_end_time INTEGER,
  event_account_xid INTEGER REFERENCES account(xid),
  event_user_xid INTEGER REFERENCES users(XID),
  event_status TEXT,
  event_result TEXT,
  event_is_deleted INTEGER DEFAULT 0,
  event_notes TEXT
);

CREATE TABLE event_contact (
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  event_xid INTEGER NOT NULL REFERENCES event(xid),
  contact_xid INTEGER NOT NULL REFERENCES contact(xid),
  role TEXT,
  status TEXT,
  notes TEXT
);

-- task_assignee is a user id.
CREATE TABLE task (
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  task_subject TEXT,
  task_due_date INTEGER,
  task_account_xid INTEGER REFERENCES account(xid),
  task_assignee_xid INTEGER REFERENCES users(xid),
  task_status TEXT,
  task_priority TEXT,
  task_is_deleted INTEGER DEFAULT 0,
  task_notes TEXT
);

CREATE TABLE task_contact (
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  task_xid INTEGER NOT NULL REFERENCES task(xid),
  contact_xid INTEGER NOT NULL REFERENCES contact(xid),
  role TEXT,
  notes TEXT
);
-- The lead can be converted into account + contact + opportunity.
-- the lead may become new account, contact, or opportunity, or we can add each element to something else.

CREATE TABLE lead (
  XID INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_first_name TEXT,
  lead_last_name TEXT,
  lead_salutation TEXT,
  lead_company TEXT,
  lead_title TEXT,

  lead_street TEXT,
  lead_street2 TEXT,
  lead_city TEXT,
  lead_state TEXT,
  lead_zip TEXT,
  lead_country TEXT,

  lead_phone TEXT,
  lead_mobile TEXT,
  lead_email TEXT,

  lead_status TEXT,
  lead_source TEXT,
  lead_owner_xid INTEGER REFERENCES users(XID),
  lead_campaign_xid INTEGER REFERENCES campaign(XID),

  lead_converted INTEGER DEFAULT 0,
  lead_converted_date INTEGER,
  lead_converted_account_xid INTEGER REFERENCES account(XID),
  lead_converted_contact_xid INTEGER REFERENCES contact(XID),
  lead_converted_opportunity_xid INTEGER REFERENCES opportunity(XID),
  lead_converted_by_xid INTEGER REFERENCES users(XID),

  lead_description TEXT,
  lead_is_deleted INTEGER DEFAULT 0,
  lead_notes TEXT
);

CREATE INDEX idx_event_contact_event
ON event_contact(event_xid);

CREATE INDEX idx_event_contact_contact
ON event_contact(contact_xid);

CREATE INDEX idx_task_contact_task
ON task_contact(task_xid);

CREATE INDEX idx_task_contact_contact
ON task_contact(contact_xid);

CREATE INDEX idx_campaign_members_campaign
ON campaign_members(campaign_xid);

CREATE INDEX idx_campaign_members_contact
ON campaign_members(campaign_contact_xid);

CREATE INDEX idx_campaign_members_status
ON campaign_members(campaign_member_status);

CREATE INDEX idx_contact_account
ON contact(contact_account_xid);

CREATE INDEX idx_opportunity_account
ON opportunity(opportunity_account_xid);

CREATE INDEX idx_task_account
ON task(task_account_xid);

CREATE INDEX idx_event_account
ON event(event_account_xid);

CREATE INDEX idx_lead_owner
ON lead(lead_owner_xid);

CREATE INDEX idx_lead_campaign
ON lead(lead_campaign_xid);

CREATE INDEX idx_account_owner
ON account(account_record_owner_xid);

CREATE INDEX idx_contact_owner
ON contact(contact_record_owner_xid);

CREATE INDEX idx_opportunity_owner
ON opportunity(opportunity_owner_xid);

CREATE INDEX idx_task_assignee
ON task(task_assignee_xid);

CREATE INDEX idx_event_start_time
ON event(event_start_time);

CREATE INDEX idx_task_due_date
ON task(task_due_date);

CREATE INDEX idx_opportunity_close_date
ON opportunity(opportunity_close_date);

CREATE INDEX idx_campaign_dates
ON campaign(campaign_start_date, campaign_end_date);

CREATE INDEX idx_campaign_members_campaign_status
ON campaign_members(campaign_xid, campaign_member_status);

CREATE INDEX idx_account_contact_relation_account
ON account_contact_relation(account_xid);

CREATE INDEX idx_account_contact_relation_contact
ON account_contact_relation(contact_xid);

CREATE INDEX idx_account_contact_relation_type
ON account_contact_relation(relationship_type);

CREATE INDEX idx_account_contact_relation_account_type
ON account_contact_relation(account_xid, relationship_type);

CREATE INDEX idx_lead_converted_contact
ON lead(lead_converted_contact_xid);

CREATE INDEX idx_lead_converted_account
ON lead(lead_converted_account_xid);

CREATE INDEX idx_lead_converted_opportunity
ON lead(lead_converted_opportunity_xid);

CREATE INDEX idx_lead_status
ON lead(lead_status);

CREATE INDEX idx_contact_name
ON contact(contact_last_name, contact_first_name);

CREATE INDEX idx_account_name
ON account(account_name);

CREATE INDEX idx_user_session_user
ON user_session(user_xid);

CREATE INDEX idx_user_session_expires
ON user_session(expires_at);

CREATE INDEX idx_api_key_user
ON api_key(user_xid);

CREATE INDEX idx_api_key_expires
ON api_key(expires_at);

CREATE INDEX idx_user_session_user
ON user_session(user_xid);

CREATE INDEX idx_user_session_expires
ON user_session(expires_at);

CREATE INDEX idx_user_active
ON users(user_is_active);
