import { useEffect, useMemo, useState } from 'react';
import * as Application from 'expo-application';
import { api } from '../api/client';
import { useScreenQuery } from './useLiveQuery';
import { useUser } from '../context/UserContext';

export interface MembershipAccess {
    paid: boolean;
    vip: boolean;
    loading: boolean;
    deviceId: string;
}

export function useMembershipAccess(): MembershipAccess {
    const [deviceId, setDeviceId] = useState('');

    useEffect(() => {
        const id = Application.applicationId + '_' + (Application.nativeApplicationVersion || 'v1');
        setDeviceId(id);
    }, []);

    const { username } = useUser();

    const { data: paidStatus, loaded: paidLoaded } = useScreenQuery(
        () => api.tokens.getMembershipStatus(deviceId, 'paid', username || undefined),
        [deviceId, username],
        { enabled: Boolean(deviceId), pollMs: 60000 },
    );

    const { data: vipStatus, loaded: vipLoaded } = useScreenQuery(
        () => api.tokens.getMembershipStatus(deviceId, 'vip', username || undefined),
        [deviceId, username],
        { enabled: Boolean(deviceId), pollMs: 60000 },
    );

    return useMemo(() => {
        const loading = !deviceId || !paidLoaded || !vipLoaded;
        return {
            paid: paidStatus?.status === 'active',
            vip: vipStatus?.status === 'active',
            loading,
            deviceId,
        };
    }, [deviceId, paidLoaded, paidStatus?.status, vipLoaded, vipStatus?.status]);
}
