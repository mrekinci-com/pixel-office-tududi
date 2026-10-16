import React from 'react';
import { Link } from 'react-router-dom';

interface SidebarHeaderProps {
    isDarkMode: boolean;
}

const SidebarHeader: React.FC<SidebarHeaderProps> = ({ isDarkMode }) => {
    return (
        <div className="flex justify-center mb-6 mt-2">
            <Link
                to="/"
                className="flex justify-center items-center mb-2 no-underline"
            >
                <span
                    className={`text-3xl font-bold tracking-tight ${
                        isDarkMode ? 'text-gray-100' : 'text-gray-900'
                    }`}
                >
                    Tududi
                </span>
            </Link>
        </div>
    );
};

export default SidebarHeader;
