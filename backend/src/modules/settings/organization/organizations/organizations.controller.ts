import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma, runAsTenant } from '../../../../db/prisma.ts';
import { ApiError } from '../../../../lib/apiError.ts';
import { sendSuccess } from '../../../../lib/apiResponse.ts';
import { createOrganizationSchema, updateOrganizationSchema } from './organizations.schemas.ts';
import { seedSystemTemplates } from '../permission-templates/permission-templates.service.ts';
import { seedSystemRoles } from '../roles/roles.service.ts';
import { withOrgCodeRetry } from './orgCode.ts';
import { composeFullName } from '../../../../lib/memberDirectory.ts';
import { uploadFile, getFileUrl } from '../../../../lib/storage.ts';

import { MASTER_CURRENCIES } from '../../../seed-data/seed-data.controller.ts';

import type { Organization, Prisma, Industry } from '../../../../../generated/prisma/client.ts';

async function resolveLogoUrl(logoUrl: string | null | undefined): Promise<string | null> {
  if (!logoUrl) return null;
  if (
    logoUrl.startsWith('http://') ||
    logoUrl.startsWith('https://') ||
    logoUrl.startsWith('data:')
  ) {
    return logoUrl;
  }
  try {
    return await getFileUrl(logoUrl);
  } catch {
    return logoUrl;
  }
}

export function getDefaultCurrencyForCountry(country?: string | null) {
  const code = country?.trim().toUpperCase();
  if (code === 'IN' || code === 'IND' || code === 'INDIA') {
    return {
      currencyCode: 'INR',
      currencyName: 'Indian Rupee',
      symbol: '₹',
    };
  }
  if (code === 'CA' || code === 'CAN' || code === 'CANADA') {
    return {
      currencyCode: 'CAD',
      currencyName: 'Canadian Dollar',
      symbol: 'CA$',
    };
  }
  return {
    currencyCode: 'USD',
    currencyName: 'US Dollar',
    symbol: '$',
  };
}

export function getCurrencyDetails(requestedCode?: string | null, country?: string | null) {
  if (requestedCode) {
    const code = requestedCode.trim().toUpperCase();
    const found = MASTER_CURRENCIES.find((c) => c.code === code);
    if (found) {
      return {
        currencyCode: found.code,
        currencyName: found.name,
        symbol: found.symbol,
      };
    }
  }
  return getDefaultCurrencyForCountry(country);
}

// Mapper to convert Prisma Organization to Zoho-style format
async function mapToZohoFormat(org: Organization & { industry?: Pick<Industry, 'name'> | null }) {
  const logoUrl = await resolveLogoUrl(org.logoUrl);
  return {
    organization_id: org.id,
    // The support code the customer reads to support. Additive — `organization_id`
    // is still the uuid, and still the only value any client should send back.
    org_code: org.orgCode,
    name: org.name,
    industryType: org.industryCode,
    email: org.email,
    phone: org.phone,
    dial_code: org.dialCode,
    address: {
      street_address1: org.orgAddress,
      country: org.countryCode,
      state_code: org.stateCode,
      city: org.cityId,
      zip: org.zip,
    },
    website: org.website,
    logo_url: logoUrl,
    account_created_date: org.createdAt.toISOString(),
    industry: org.industry, // from include
  };
}

export async function createOrganization(req: Request, res: Response, next: NextFunction) {
  try {
    const parsedData = createOrganizationSchema.safeParse(req.body);
    if (!parsedData.success) {
      throw ApiError.badRequest('Validation failed', parsedData.error.issues);
    }
    const data = parsedData.data;

    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Sign in to continue.');
    }
    // force restart for prisma base currency schema update

    const orgId = crypto.randomUUID();

    // The retry wraps the ENTIRE transaction rather than the create inside it: a
    // unique violation aborts the surrounding Postgres transaction, so re-rolling
    // the code within this callback could never commit. A rolled-back attempt
    // leaves nothing behind, so reusing `orgId` across attempts is safe.
    const organization = await withOrgCodeRetry((orgCode) =>
      runAsTenant(orgId, async (tx) => {
        const created = await tx.organization.create({
          data: {
            id: orgId,
            orgCode,
            name: data.name,
            industryCode: data.industryType,
            email: data.email,
            phone: data.phone,
            dialCode: data.dial_code,
            orgAddress: data.address?.street_address1 || null,
            countryCode: data.address?.country || null,
            stateCode: data.address?.state_code || null,
            cityId: data.address?.city || null,
            zip: data.address?.zip || null,
            createdBy: userId,
            updatedBy: userId,
          },
        });

        const baseCurrency = getCurrencyDetails(data.baseCurrency, data.address?.country);

        const [{ ownerTemplateId }, { ownerRoleId }] = await Promise.all([
          seedSystemTemplates(tx, orgId, userId),
          seedSystemRoles(tx, orgId, userId),
          // Automatically create a default Currency based on country
          tx.currency.create({
            data: {
              organizationId: orgId,
              currencyCode: baseCurrency.currencyCode,
              currencyName: baseCurrency.currencyName,
              symbol: baseCurrency.symbol,
              decimalPlaces: 2,
              format: '1,234,567.89',
              exchangeRate: 1,
              isBaseCurrency: false,
              createdBy: userId,
              updatedBy: userId,
            },
          }),
        ]);

        // The owner's per-org name starts as a copy of their account name. From here
        // the two are independent: renaming themselves in this org (PUT
        // /members/me) leaves the account untouched, and vice versa. A brand-new
        // account whose name was never filled in falls back to the email local-part
        // rather than storing an empty NOT NULL string that renders as a blank row.
        const account = await tx.user.findUnique({
          where: { id: userId },
          select: { firstName: true, lastName: true, email: true },
        });
        const ownerFirstName =
          account?.firstName?.trim() || account?.email.split('@')[0] || 'Owner';
        const ownerLastName = account?.lastName?.trim() || '';

        await tx.membership.create({
          data: {
            userId,
            organizationId: orgId,
            firstName: ownerFirstName,
            lastName: ownerLastName,
            fullName: composeFullName(ownerFirstName, ownerLastName),
            isOwner: true,
            roleId: ownerRoleId,
            permissionTemplateId: ownerTemplateId,
            createdBy: userId,
            updatedBy: userId,
          },
        });

        return created;
      }),
    );

    // We emulate Zoho's generic envelope: { code: 0, message: "success", organization: { ... } }
    res.status(201).json({
      code: 0,
      message: 'success',
      organization: await mapToZohoFormat(organization),
    });
  } catch (error) {
    next(error);
  }
}

export async function getOrganizations(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Sign in to continue.');
    }

    const organizations = await prisma.organization.findMany({
      where: {
        isDeleted: false,
        memberships: {
          some: {
            userId,
          },
        },
      },
      include: { industry: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const formattedOrgs = await Promise.all(organizations.map(mapToZohoFormat));

    res.status(200).json({
      code: 0,
      message: 'success',
      organizations: formattedOrgs,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateOrganization(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    const orgId = req.tenantId!;
    if (!userId) {
      throw new ApiError(401, 'Sign in to continue.');
    }

    const parsedData = updateOrganizationSchema.safeParse(req.body);
    if (!parsedData.success) {
      throw ApiError.badRequest('Validation failed', parsedData.error.issues);
    }

    const data = parsedData.data;

    // Map Zoho keys back to Prisma fields for update
    const updateData: Prisma.OrganizationUncheckedUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.industryType !== undefined) updateData.industryCode = data.industryType;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.dial_code !== undefined) updateData.dialCode = data.dial_code;
    if (data.website !== undefined) updateData.website = data.website;

    if (data.address !== undefined) {
      if (data.address.street_address1 !== undefined)
        updateData.orgAddress = data.address.street_address1;
      if (data.address.country !== undefined) updateData.countryCode = data.address.country;
      if (data.address.state_code !== undefined)
        updateData.stateCode = data.address.state_code === '' ? null : data.address.state_code;
      if (data.address.city !== undefined)
        updateData.cityId = data.address.city === '' ? null : data.address.city;
      if (data.address.zip !== undefined) updateData.zip = data.address.zip;
    }

    updateData.updatedBy = userId;

    const updatedOrg = await prisma.organization.update({
      where: { id: orgId },
      data: updateData,
      include: { industry: { select: { name: true } } },
    });

    res.status(200).json({
      code: 0,
      message: 'success',
      organization: await mapToZohoFormat(updatedOrg),
    });
  } catch (error) {
    next(error);
  }
}

export async function uploadOrganizationLogo(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    const orgId = (req.params.orgId as string) || req.tenantId;
    if (!userId) {
      throw new ApiError(401, 'Sign in to continue.');
    }
    if (!orgId) {
      throw ApiError.badRequest('Organization ID is required');
    }

    const file = req.file;
    if (!file) {
      throw ApiError.badRequest('No image file provided.');
    }

    const timestamp = Date.now();
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const key = `organizations/${orgId}/logo-${timestamp}-${cleanName}`;

    await uploadFile({
      key,
      body: file.buffer,
      contentType: file.mimetype,
      overwrite: true,
    });

    const updatedOrg = await prisma.organization.update({
      where: { id: orgId },
      data: {
        logoUrl: key,
        updatedBy: userId,
      },
      include: { industry: { select: { name: true } } },
    });

    const formatted = await mapToZohoFormat(updatedOrg);
    sendSuccess(res, formatted, 'Logo uploaded successfully.');
  } catch (error) {
    next(error);
  }
}

export async function deleteOrganization(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    // `requireOwner` on the route already proved ownership — and unlike the check
    // this replaced, it cannot be satisfied by any permission template.
    const orgId = req.tenantId!;
    if (!userId) {
      throw new ApiError(401, 'Sign in to continue.');
    }

    // Soft delete: keep the row, flip isDeleted, and record who removed it.
    // getOrganizations filters isDeleted=false, so it disappears from listings.
    await prisma.organization.update({
      where: { id: orgId },
      data: { isDeleted: true, updatedBy: userId },
    });

    sendSuccess(res, null, 'Organization deleted successfully');
  } catch (error) {
    next(error);
  }
}

export async function deleteOrganizationLogo(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    const orgId = req.tenantId!;
    if (!userId) {
      throw new ApiError(401, 'Sign in to continue.');
    }

    const updatedOrg = await prisma.organization.update({
      where: { id: orgId },
      data: {
        logoUrl: null,
        updatedBy: userId,
      },
      include: { industry: { select: { name: true } } },
    });

    const formatted = await mapToZohoFormat(updatedOrg);
    sendSuccess(res, formatted, 'Logo removed successfully.');
  } catch (error) {
    next(error);
  }
}
