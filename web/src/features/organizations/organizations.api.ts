import { apiClient } from '../../api/client';
import type { Organization, CreateOrganizationData, UpdateOrganizationData } from './organizations.schemas';

/* eslint-disable @typescript-eslint/naming-convention */
type RawOrganization = Partial<Organization> & {
  dial_code?: string;
  organization_id?: string;
  tax_id_value?: string;
  account_created_date?: string;
  address?: Organization['address'] & {
    street_address1?: string;
    state_code?: string;
  };
};
/* eslint-enable @typescript-eslint/naming-convention */

export const organizationsApi = {
  getOrganizations: async (): Promise<Organization[]> => {
    const response = await apiClient.get('/organizations');
    const orgs = response.data.organizations || response.data;
    return Array.isArray(orgs) ? orgs.map((org: RawOrganization) => ({
      ...org,
      dialCode: org.dialCode || org.dial_code,
      organizationId: org.organizationId || org.organization_id,
      taxIdValue: org.taxIdValue || org.tax_id_value,
      accountCreatedDate: org.accountCreatedDate || org.account_created_date,
      address: org.address ? {
        ...org.address,
        streetAddress1: org.address.streetAddress1 || org.address.street_address1,
        stateCode: org.address.stateCode || org.address.state_code,
      } : undefined,
    }) as Organization) : orgs;
  },

  createOrganization: async (data: CreateOrganizationData): Promise<Organization> => {
    /* eslint-disable @typescript-eslint/naming-convention */
    const payload = {
      ...data,
      dial_code: data.dialCode,
      tax_id_value: data.taxIdValue,
      address: data.address ? {
        ...data.address,
        street_address1: data.address.streetAddress1,
        state_code: data.address.stateCode,
      } : undefined,
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    const response = await apiClient.post('/organizations', payload);
    const org = response.data.organization || response.data;
    return {
      ...org,
      dialCode: org.dialCode || org.dial_code,
      organizationId: org.organizationId || org.organization_id,
      taxIdValue: org.taxIdValue || org.tax_id_value,
      accountCreatedDate: org.accountCreatedDate || org.account_created_date,
      address: org.address ? {
        ...org.address,
        streetAddress1: org.address.streetAddress1 || org.address.street_address1,
        stateCode: org.address.stateCode || org.address.state_code,
      } : undefined,
    };
  },

  updateOrganization: async (id: string, data: UpdateOrganizationData): Promise<Organization> => {
    /* eslint-disable @typescript-eslint/naming-convention */
    const payload = {
      ...data,
      dial_code: data.dialCode,
      tax_id_value: data.taxIdValue,
      address: data.address ? {
        ...data.address,
        street_address1: data.address.streetAddress1,
        state_code: data.address.stateCode,
      } : undefined,
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    const response = await apiClient.put(`/organizations/${id}`, payload);
    const org = response.data.organization || response.data;
    return {
      ...org,
      dialCode: org.dialCode || org.dial_code,
      organizationId: org.organizationId || org.organization_id,
      taxIdValue: org.taxIdValue || org.tax_id_value,
      accountCreatedDate: org.accountCreatedDate || org.account_created_date,
      address: org.address ? {
        ...org.address,
        streetAddress1: org.address.streetAddress1 || org.address.street_address1,
        stateCode: org.address.stateCode || org.address.state_code,
      } : undefined,
    };
  },

  deleteOrganization: async (id: string): Promise<void> => {
    await apiClient.delete(`/organizations/${id}`);
  },

  uploadLogo: async (id: string, file: File): Promise<Organization> => {
    const formData = new FormData();
    formData.append('logo', file);

    const response = await apiClient.post(`/organizations/${id}/logo`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    const org = response.data.organization || response.data;
    return {
      ...org,
      dialCode: org.dialCode || org.dial_code,
      organizationId: org.organizationId || org.organization_id,
      taxIdValue: org.taxIdValue || org.tax_id_value,
      logo_url: org.logo_url,
      accountCreatedDate: org.accountCreatedDate || org.account_created_date,
      address: org.address ? {
        ...org.address,
        streetAddress1: org.address.streetAddress1 || org.address.street_address1,
        stateCode: org.address.stateCode || org.address.state_code,
      } : undefined,
    };
  },

  getSeedData: async () => {
    const response = await apiClient.get('/seed-data');
    return response.data;
  },
};


