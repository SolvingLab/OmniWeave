import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const recordsApi = createApi({
  reducerPath: 'recordsApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  endpoints: (builder) => ({
    getRecords: builder.query({
      query: () => 'records',
    }),
    addRecord: builder.mutation({
      query: (body) => ({ url: 'records', method: 'POST', body }),
    }),
  }),
});

export const { useGetRecordsQuery, useAddRecordMutation } = recordsApi;
