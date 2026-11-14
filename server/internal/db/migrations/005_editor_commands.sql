ALTER TABLE board_pages ADD COLUMN deleted_by UUID, ADD COLUMN deleted_client_id UUID;
ALTER TABLE board_stamps ADD COLUMN deleted_by UUID, ADD COLUMN deleted_client_id UUID;
