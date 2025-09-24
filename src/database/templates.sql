-- Insert the ready-to-send message templates for the LLC follow-up sequence

-- Clear existing templates (optional - remove if you want to keep existing ones)
-- DELETE FROM message_templates WHERE name LIKE 'llc_day_%';

-- Day 1 - EIN / Tax ID Templates
INSERT INTO message_templates (name, type, subject, content, variables) VALUES
('llc_day1_ein_sms', 'sms', NULL, 
'Congrats on forming {{company_name}}! Based on your {{business_type}}, you''ll need an EIN for taxes and banking. Get yours quickly here: {{ein_link}}. Reply STOP to opt out.',
'["company_name", "business_type", "ein_link"]'),

('llc_day1_ein_email', 'email', '{{company_name}}: Your Next Step After LLC Formation',
'Hi {{owner_name}},

Congratulations on registering your {{business_type}}! Based on your business type, we recommend getting your EIN immediately as it''s required for taxes, banking, and hiring employees.

{{business_recommendation}}

Get your EIN easily through our trusted partner: {{ein_link}}

—
If you''d rather not receive these emails, unsubscribe here: {{unsubscribe_link}}',
'["company_name", "owner_name", "business_type", "business_recommendation", "ein_link", "unsubscribe_link"]');

-- Day 3-5 - Business Banking Templates
INSERT INTO message_templates (name, type, subject, content, variables) VALUES
('llc_day3_banking_sms', 'sms', NULL,
'Hey {{company_name}} owner! Based on your {{business_type}}, we recommend opening a business bank account now. {{banking_recommendation}} Start here: {{banking_link}}. Reply STOP to unsubscribe.',
'["company_name", "business_type", "banking_recommendation", "banking_link"]'),

('llc_day3_banking_email', 'email', 'Set Up Your Business Bank Account Easily',
'Hi {{owner_name}},

Your new {{business_type}} is ready! Based on your business type, we recommend setting up proper financial separation immediately.

{{banking_recommendation}}

Our partners make it simple: {{banking_link}}

—
Unsubscribe anytime: {{unsubscribe_link}}',
'["owner_name", "business_type", "banking_recommendation", "banking_link", "unsubscribe_link"]');

-- Day 7-10 - Accounting / Bookkeeping Templates
INSERT INTO message_templates (name, type, subject, content, variables) VALUES
('llc_day7_accounting_sms', 'sms', NULL,
'{{company_name}} is ready to grow! Based on your {{business_type}}, we recommend professional bookkeeping. {{accounting_recommendation}} Get started: {{accounting_link}}. Reply STOP to unsubscribe.',
'["company_name", "business_type", "accounting_recommendation", "accounting_link"]'),

('llc_day7_accounting_email', 'email', 'Keep Your LLC Finances Organized',
'Hi {{owner_name}},

Congrats on getting your EIN and bank account! Based on your {{business_type}}, proper accounting is crucial for your success.

{{accounting_recommendation}}

Simplify accounting with our recommended service: {{accounting_link}}. Avoid headaches and stay compliant.

—
To stop receiving messages, click here: {{unsubscribe_link}}',
'["owner_name", "business_type", "accounting_recommendation", "accounting_link", "unsubscribe_link"]');

-- Day 10-14 - Registered Agent / Compliance Templates
INSERT INTO message_templates (name, type, subject, content, variables) VALUES
('llc_day10_compliance_sms', 'sms', NULL,
'Reminder: Based on your {{business_type}}, you need a registered agent to stay compliant. {{compliance_recommendation}} Secure one here: {{compliance_link}}. Reply STOP to unsubscribe.',
'["business_type", "compliance_recommendation", "compliance_link"]'),

('llc_day10_compliance_email', 'email', 'Ensure Your LLC Stays Compliant',
'Hi {{owner_name}},

Based on your {{business_type}}, maintaining compliance is essential for legal protection.

{{compliance_recommendation}}

A registered agent ensures your LLC receives legal documents on time. Protect your business today with {{compliance_link}}.

—
Unsubscribe anytime: {{unsubscribe_link}}',
'["owner_name", "business_type", "compliance_recommendation", "compliance_link", "unsubscribe_link"]');

-- Day 15+ - Business Insurance Templates
INSERT INTO message_templates (name, type, subject, content, variables) VALUES
('llc_day15_insurance_sms', 'sms', NULL,
'Protect {{company_name}} with business insurance today. Based on your {{business_type}}, {{insurance_recommendation}} Get quotes: {{insurance_link}}. Reply STOP to unsubscribe.',
'["company_name", "business_type", "insurance_recommendation", "insurance_link"]'),

('llc_day15_insurance_email', 'email', 'Safeguard Your New LLC',
'Hi {{owner_name}},

Based on your {{business_type}}, proper insurance coverage is essential for protecting your investment.

{{insurance_recommendation}}

Compare insurance options quickly through our trusted partner: {{insurance_link}}.

—
Unsubscribe here: {{unsubscribe_link}}',
'["owner_name", "business_type", "insurance_recommendation", "insurance_link", "unsubscribe_link"]');
