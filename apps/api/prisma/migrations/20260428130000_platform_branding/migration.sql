CREATE TABLE "platform_branding" (
    "id" TEXT NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL DEFAULT '',
    "registration_no" VARCHAR(80),
    "product_label" VARCHAR(160) NOT NULL DEFAULT 'Policy Manager',
    "logo_data_url" TEXT,
    "lockup_image_src" VARCHAR(512) NOT NULL DEFAULT '/branding/lockup-astrum-veda.png',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_branding_pkey" PRIMARY KEY ("id")
);

INSERT INTO "platform_branding" ("id", "legal_name", "product_label", "lockup_image_src", "created_at", "updated_at")
VALUES ('default', '', 'Policy Manager', '/branding/lockup-astrum-veda.png', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
