import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
    enabled: boolean;
    isUploading: boolean;
    status: string;
    uploadFiles: (files: File[]) => void;
}

const TerminalUploadControl: React.FC<Props> = ({
    enabled,
    isUploading,
    status,
    uploadFiles,
}) => {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    if (!enabled) return null;
    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                hidden
                aria-label={t('terminal.selectImages', 'Select images')}
                onChange={(event) => {
                    uploadFiles(Array.from(event.currentTarget.files || []));
                    event.currentTarget.value = '';
                }}
            />
            <button
                type="button"
                disabled={isUploading}
                onClick={() => inputRef.current?.click()}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
            >
                {t('terminal.addImage', 'Add image')}
            </button>
            {status && (
                <span
                    role="status"
                    aria-live="polite"
                    className="text-xs text-gray-600 dark:text-gray-300"
                >
                    {status}
                </span>
            )}
        </>
    );
};

export default TerminalUploadControl;
