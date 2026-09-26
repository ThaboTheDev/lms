-- CreateEnum
CREATE TYPE "DigestFrequency" AS ENUM ('OFF', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "PackageKind" AS ENUM ('SCORM', 'H5P');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "SurveyStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SurveyQuestionType" AS ENUM ('RATING', 'CHOICE', 'TEXT');

-- CreateEnum
CREATE TYPE "PeerReviewStatus" AS ENUM ('ASSIGNED', 'SUBMITTED');

-- AlterEnum
ALTER TYPE "LiveProvider" ADD VALUE 'JITSI';

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "accessTokenHash" TEXT;

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "integrityMonitoring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "peerReviewCount" INTEGER,
ADD COLUMN     "peerReviewDueAt" TIMESTAMP(3),
ADD COLUMN     "requireSafeExamBrowser" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sebConfigKeys" TEXT[];

-- AlterTable
ALTER TABLE "Institution" ADD COLUMN     "domain" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "digestFrequency" "DigestFrequency" NOT NULL DEFAULT 'OFF',
ADD COLUMN     "lastDigestAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LearningPackage" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "offeringId" TEXT,
    "kind" "PackageKind" NOT NULL,
    "title" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "storagePrefix" TEXT NOT NULL,
    "launchPath" TEXT NOT NULL DEFAULT 'index.html',
    "version" TEXT,
    "status" "PackageStatus" NOT NULL DEFAULT 'PROCESSING',
    "error" TEXT,
    "manifest" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageAttempt" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "completion" TEXT,
    "success" TEXT,
    "scoreRaw" DECIMAL(8,2),
    "scoreMax" DECIMAL(8,2),
    "scoreScaled" DECIMAL(5,4),
    "totalTimeSec" INTEGER NOT NULL DEFAULT 0,
    "location" TEXT,
    "suspendData" TEXT,
    "data" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Survey" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "offeringId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT true,
    "status" "SurveyStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Survey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyQuestion" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "prompt" TEXT NOT NULL,
    "type" "SurveyQuestionType" NOT NULL DEFAULT 'RATING',
    "options" TEXT[],
    "isRequired" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SurveyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyResponse" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "respondentKey" TEXT NOT NULL,
    "respondentId" TEXT,
    "answers" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeerReviewAllocation" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "status" "PeerReviewStatus" NOT NULL DEFAULT 'ASSIGNED',
    "score" DECIMAL(6,2),
    "feedback" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeerReviewAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrityEvent" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentGatewayEvent" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "status" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentGatewayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningPackage_offeringId_status_idx" ON "LearningPackage"("offeringId", "status");

-- CreateIndex
CREATE INDEX "LearningPackage_institutionId_idx" ON "LearningPackage"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "PackageAttempt_packageId_userId_key" ON "PackageAttempt"("packageId", "userId");

-- CreateIndex
CREATE INDEX "Survey_offeringId_status_idx" ON "Survey"("offeringId", "status");

-- CreateIndex
CREATE INDEX "Survey_institutionId_idx" ON "Survey"("institutionId");

-- CreateIndex
CREATE INDEX "SurveyQuestion_surveyId_orderIndex_idx" ON "SurveyQuestion"("surveyId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyResponse_surveyId_respondentKey_key" ON "SurveyResponse"("surveyId", "respondentKey");

-- CreateIndex
CREATE INDEX "PeerReviewAllocation_assessmentId_reviewerId_idx" ON "PeerReviewAllocation"("assessmentId", "reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "PeerReviewAllocation_submissionId_reviewerId_key" ON "PeerReviewAllocation"("submissionId", "reviewerId");

-- CreateIndex
CREATE INDEX "IntegrityEvent_submissionId_occurredAt_idx" ON "IntegrityEvent"("submissionId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "PaymentGatewayEvent_institutionId_receivedAt_idx" ON "PaymentGatewayEvent"("institutionId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentGatewayEvent_provider_externalId_key" ON "PaymentGatewayEvent"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_accessTokenHash_key" ON "Application"("accessTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_domain_key" ON "Institution"("domain");

-- AddForeignKey
ALTER TABLE "LearningPackage" ADD CONSTRAINT "LearningPackage_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPackage" ADD CONSTRAINT "LearningPackage_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPackage" ADD CONSTRAINT "LearningPackage_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageAttempt" ADD CONSTRAINT "PackageAttempt_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "LearningPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageAttempt" ADD CONSTRAINT "PackageAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Survey" ADD CONSTRAINT "Survey_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Survey" ADD CONSTRAINT "Survey_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyQuestion" ADD CONSTRAINT "SurveyQuestion_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "Survey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_respondentId_fkey" FOREIGN KEY ("respondentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeerReviewAllocation" ADD CONSTRAINT "PeerReviewAllocation_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeerReviewAllocation" ADD CONSTRAINT "PeerReviewAllocation_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeerReviewAllocation" ADD CONSTRAINT "PeerReviewAllocation_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrityEvent" ADD CONSTRAINT "IntegrityEvent_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentGatewayEvent" ADD CONSTRAINT "PaymentGatewayEvent_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

